import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'

// Lazy initialization - only create connection when needed
function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Self-bootstraps the rolling-backup table. Snapshots are tiny insurance
// against an autosave race or accidental wipe: the last ~50 minutes of
// canvas history are recoverable via the snapshots endpoint.
// Param typed `any` to side-step Neon's deeply-generic SQL function type.
async function ensureSnapshotsSchema(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS canvas_snapshots (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  text NOT NULL,
      saved_at    timestamptz NOT NULL DEFAULT now(),
      nodes_json  jsonb NOT NULL,
      edges_json  jsonb NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_project ON canvas_snapshots(project_id, saved_at DESC)`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { nodes, edges } = await request.json()

    // FAILSAFE: never blow away a non-empty canvas with an empty payload.
    // The client has a matching guard but a stale request from a closed
    // tab / racing beacon / error boundary could still reach us. We let
    // an explicit ?force=true override this for the rare case the user
    // genuinely cleared the canvas to empty.
    if (Array.isArray(nodes) && nodes.length === 0) {
      const url = new URL(request.url)
      const force = url.searchParams.get('force') === 'true'
      if (!force) {
        const existing = await sql`
          SELECT COUNT(*)::int AS n FROM canvas_nodes WHERE projectId = ${projectId}::text
        `
        const existingCount = (existing[0] as any)?.n ?? 0
        if (existingCount > 0) {
          console.warn(
            `[canvas] Refusing empty-nodes save for project ${projectId}: DB has ${existingCount} nodes. Add ?force=true to override.`,
          )
          return NextResponse.json({
            success: false,
            skipped: 'empty-wipe-guard',
            existingNodes: existingCount,
          })
        }
      }
    }

    // Neon's HTTP driver runs each tagged-template invocation as its own
    // round-trip — so the old `sql\`BEGIN\`` / `sql\`COMMIT\`` pattern was
    // NOT actually atomic, just a sequence of separate statements that
    // could leave the canvas half-written on a mid-loop failure. The
    // driver's .transaction(queries[]) method, by contrast, ships every
    // query in a single HTTP request and wraps the lot in one real
    // transaction. That fixes the atomicity bug AND collapses ~60
    // round-trips on a 30-node canvas down to one.
    const writeQueries = [
      sql`DELETE FROM canvas_nodes WHERE projectId = ${projectId}::text`,
      sql`DELETE FROM canvas_edges WHERE projectId = ${projectId}::text`,
    ]
    for (const node of nodes) {
      writeQueries.push(sql`
        INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
        VALUES (${projectId}::text, ${node.id}, ${node.type}, ${node.position.x}, ${node.position.y}, ${JSON.stringify(node.data)})
        ON CONFLICT (projectId, nodeId) DO UPDATE SET
          type = EXCLUDED.type,
          position_x = EXCLUDED.position_x,
          position_y = EXCLUDED.position_y,
          data = EXCLUDED.data
      `)
    }
    for (const edge of edges) {
      writeQueries.push(sql`
        INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
        VALUES (${projectId}::text, ${edge.id}, ${edge.source}, ${edge.target}, ${edge.sourceHandle}, ${edge.targetHandle}, ${edge.animated}, ${JSON.stringify(edge.data || {})})
        ON CONFLICT (projectId, edgeId) DO UPDATE SET
          source = EXCLUDED.source,
          target = EXCLUDED.target,
          sourceHandle = EXCLUDED.sourceHandle,
          targetHandle = EXCLUDED.targetHandle,
          animated = EXCLUDED.animated,
          data = EXCLUDED.data
      `)
    }
    await sql.transaction(writeQueries)

    // Rolling-backup snapshot: write the just-saved state to a separate
    // snapshots table so we can recover from a botched save / accidental
    // wipe. Throttled to one snapshot per 5 minutes per project to avoid
    // filling the rolling window with near-identical states during rapid
    // editing, capped to the most recent 30 snapshots per project —
    // roughly 2.5 hours of recoverable history, comfortable for a long
    // editing session. Any failure here is non-fatal — the main save
    // already succeeded.
    try {
      await ensureSnapshotsSchema(sql)
      const lastSnap = await sql`
        SELECT saved_at FROM canvas_snapshots
        WHERE project_id = ${projectId}
        ORDER BY saved_at DESC LIMIT 1
      `
      const lastTs = (lastSnap[0] as any)?.saved_at
      const tooSoon =
        lastTs && Date.now() - new Date(lastTs).getTime() < 5 * 60 * 1000
      if (!tooSoon) {
        await sql`
          INSERT INTO canvas_snapshots (project_id, nodes_json, edges_json)
          VALUES (
            ${projectId},
            ${JSON.stringify(nodes)}::jsonb,
            ${JSON.stringify(edges)}::jsonb
          )
        `
        await sql`
          DELETE FROM canvas_snapshots
          WHERE project_id = ${projectId}
            AND id IN (
              SELECT id FROM canvas_snapshots
              WHERE project_id = ${projectId}
              ORDER BY saved_at DESC
              OFFSET 30
            )
        `
      }
    } catch (snapErr) {
      console.error('[canvas] Snapshot write failed (non-fatal):', snapErr)
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
