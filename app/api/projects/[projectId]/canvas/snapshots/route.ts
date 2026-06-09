import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/projects/<id>/canvas/snapshots
// Returns the rolling list of canvas snapshots for this project (newest
// first), each with a small summary so the user can pick one to restore.
// Use case: "the canvas looks wrong after a save / browser crash — give
// me a previous version."
//
// To restore, POST to this same URL with `{ snapshotId: '<uuid>' }`. The
// restore overwrites the current canvas with the snapshot's nodes/edges,
// but BEFORE doing so it takes a fresh snapshot of the current state,
// so a restore itself is undoable by restoring the snapshot taken just
// before it.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const rows = await sql`
      SELECT id, saved_at,
             jsonb_array_length(nodes_json) AS node_count,
             jsonb_array_length(edges_json) AS edge_count
      FROM canvas_snapshots
      WHERE project_id = ${projectId}
      ORDER BY saved_at DESC
    `
    return NextResponse.json({
      snapshots: rows.map((r: any) => ({
        id: r.id,
        savedAt: r.saved_at,
        nodeCount: r.node_count,
        edgeCount: r.edge_count,
      })),
    })
  } catch (err: any) {
    console.error('[canvas/snapshots] GET error:', err)
    return NextResponse.json(
      { error: 'failed to list snapshots' },
      { status: 500 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { snapshotId } = await request.json()
    if (!snapshotId) {
      return NextResponse.json(
        { error: 'snapshotId is required' },
        { status: 400 },
      )
    }

    const snap = await sql`
      SELECT id, nodes_json, edges_json
      FROM canvas_snapshots
      WHERE project_id = ${projectId} AND id = ${snapshotId}::uuid
      LIMIT 1
    `
    if (snap.length === 0) {
      return NextResponse.json(
        { error: 'snapshot not found' },
        { status: 404 },
      )
    }
    const nodes = (snap[0] as any).nodes_json as any[]
    const edges = (snap[0] as any).edges_json as any[]

    // Take a fresh "pre-restore" snapshot of the CURRENT canvas so the
    // restore itself is undoable. This is the only path that bypasses
    // the per-5min throttle on snapshots — restore is an intentional
    // checkpoint.
    try {
      const current = await sql`
        SELECT nodeId AS id, type, position_x, position_y, data
        FROM canvas_nodes WHERE projectId = ${projectId}::text
      `
      const currentEdges = await sql`
        SELECT edgeid AS id, source, target, sourcehandle, targethandle, animated, data
        FROM canvas_edges WHERE projectId = ${projectId}::text
      `
      const currentNodes = current.map((row: any) => ({
        id: row.id,
        type: row.type,
        position: { x: row.position_x, y: row.position_y },
        data: row.data || {},
      }))
      await sql`
        INSERT INTO canvas_snapshots (project_id, nodes_json, edges_json)
        VALUES (
          ${projectId},
          ${JSON.stringify(currentNodes)}::jsonb,
          ${JSON.stringify(currentEdges)}::jsonb
        )
      `
      // Trim back to the 30-snapshot cap (matches canvas save route).
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
    } catch (preSnapErr) {
      console.error('[canvas/snapshots] pre-restore snapshot failed (non-fatal):', preSnapErr)
    }

    // Replace the canvas with the chosen snapshot. Same atomic pattern
    // as the main save route.
    const writeQueries = [
      sql`DELETE FROM canvas_nodes WHERE projectId = ${projectId}::text`,
      sql`DELETE FROM canvas_edges WHERE projectId = ${projectId}::text`,
    ]
    for (const node of nodes) {
      writeQueries.push(sql`
        INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
        VALUES (${projectId}::text, ${node.id}, ${node.type}, ${node.position.x}, ${node.position.y}, ${JSON.stringify(node.data)})
      `)
    }
    for (const edge of edges) {
      writeQueries.push(sql`
        INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
        VALUES (${projectId}::text, ${edge.id}, ${edge.source}, ${edge.target}, ${edge.sourceHandle}, ${edge.targetHandle}, ${edge.animated}, ${JSON.stringify(edge.data || {})})
      `)
    }
    await sql.transaction(writeQueries)

    return NextResponse.json({
      success: true,
      restored: { nodeCount: nodes.length, edgeCount: edges.length },
    })
  } catch (err: any) {
    console.error('[canvas/snapshots] POST error:', err)
    return NextResponse.json(
      { error: 'restore failed' },
      { status: 500 },
    )
  }
}
