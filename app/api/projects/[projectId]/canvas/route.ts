import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'

// Lazy initialization - only create connection when needed
function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { nodes, edges } = await request.json()

    // Use a transaction to ensure atomicity
    await sql`BEGIN`
    
    try {
      // Delete existing nodes and edges for this project
      await sql`DELETE FROM canvas_nodes WHERE projectId = ${projectId}::text`
      await sql`DELETE FROM canvas_edges WHERE projectId = ${projectId}::text`

      // Insert new nodes using UPSERT to handle race conditions
      for (const node of nodes) {
        await sql`
          INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
          VALUES (${projectId}::text, ${node.id}, ${node.type}, ${node.position.x}, ${node.position.y}, ${JSON.stringify(node.data)})
          ON CONFLICT (projectId, nodeId) DO UPDATE SET
            type = EXCLUDED.type,
            position_x = EXCLUDED.position_x,
            position_y = EXCLUDED.position_y,
            data = EXCLUDED.data
        `
      }

      // Insert new edges using UPSERT
      for (const edge of edges) {
        await sql`
          INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
          VALUES (${projectId}::text, ${edge.id}, ${edge.source}, ${edge.target}, ${edge.sourceHandle}, ${edge.targetHandle}, ${edge.animated}, ${JSON.stringify(edge.data || {})})
          ON CONFLICT (projectId, edgeId) DO UPDATE SET
            source = EXCLUDED.source,
            target = EXCLUDED.target,
            sourceHandle = EXCLUDED.sourceHandle,
            targetHandle = EXCLUDED.targetHandle,
            animated = EXCLUDED.animated,
            data = EXCLUDED.data
        `
      }
      
      await sql`COMMIT`
    } catch (txError) {
      await sql`ROLLBACK`
      throw txError
    }

    // Reconcile asset protection: anything referenced by a node on the canvas
    // is "protected" (never auto-deleted); anything previously protected in
    // this project but no longer on the canvas gets a fresh 30-day window.
    try {
      const urls = new Set<string>()
      const ids = new Set<string>()
      for (const node of nodes) {
        const d = (node && node.data) || {}
        if (typeof d.outputUrl === 'string' && d.outputUrl) urls.add(d.outputUrl)
        if (typeof d.thumbnail === 'string' && d.thumbnail) urls.add(d.thumbnail)
        if (typeof d.assetId === 'string' && d.assetId) ids.add(d.assetId)
      }
      const urlArr = Array.from(urls)
      const idArr = Array.from(ids)

      if (urlArr.length || idArr.length) {
        await sql`
          UPDATE generation_history
          SET used_in_canvas = true, expires_at = NULL
          WHERE project_id = ${projectId}
            AND (r2_url = ANY(${urlArr}::text[]) OR id = ANY(${idArr}::text[]))
        `
      }

      // Folder membership is sticky protection too. Re-promote any folder
      // member that was previously demoted (e.g. by an earlier autosave
      // that didn't yet know about folders). Cheap — the EXISTS subquery
      // is keyed by asset_id which is the FK target.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = true, expires_at = NULL
        WHERE project_id = ${projectId}
          AND (used_in_canvas = false OR expires_at IS NOT NULL)
          AND EXISTS (
            SELECT 1 FROM asset_folder_items fi WHERE fi.asset_id = generation_history.id
          )
      `

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      // Demote assets no longer on the canvas back to a 30-day temp life
      // — UNLESS they're also a member of a folder. Folder membership is
      // a separate, sticky protection: the user explicitly filed them
      // under Characters/Props/Locations/General and expects them to
      // survive cleanup until manually deleted.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = false, expires_at = ${expiresAt}
        WHERE project_id = ${projectId}
          AND used_in_canvas = true
          AND NOT (r2_url = ANY(${urlArr}::text[]) OR id = ANY(${idArr}::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM asset_folder_items fi WHERE fi.asset_id = generation_history.id
          )
      `
    } catch (reconcileErr) {
      // Never fail the save because of reconciliation.
      console.error('[canvas] Protection reconcile failed:', reconcileErr)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Error saving canvas:', error)
    return NextResponse.json({ error: 'Failed to save canvas' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    // Fetch nodes (cast to text to avoid UUID inference)
    const nodesResult = await sql`
      SELECT nodeId as id, type, position_x, position_y, data
      FROM canvas_nodes
      WHERE projectId = ${projectId}::text
      ORDER BY createdAt
    `

    // Fetch edges (column names are lowercase in PostgreSQL)
    const edgesResult = await sql`
      SELECT edgeid as id, source, target, sourcehandle, targethandle, animated, data
      FROM canvas_edges
      WHERE projectId = ${projectId}::text
      ORDER BY createdAt
    `

    const nodes = nodesResult.map((row: any) => ({
      id: row.id,
      type: row.type,
      position: { x: row.position_x, y: row.position_y },
      data: row.data || {},
    }))

    const edges = edgesResult.map((row: any) => ({
      id: row.id,
      source: row.source,
      target: row.target,
      sourceHandle: row.sourcehandle,
      targetHandle: row.targethandle,
      animated: row.animated,
      data: row.data || {},
    }))

    return NextResponse.json({ nodes, edges })
  } catch (error) {
    console.error('[v0] Error loading canvas:', error)
    return NextResponse.json({ error: 'Failed to load canvas' }, { status: 500 })
  }
}
