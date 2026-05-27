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
