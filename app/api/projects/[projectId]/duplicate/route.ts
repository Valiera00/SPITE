import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

// Duplicate a project: copies the project row, all of its canvas_nodes, and
// all of its canvas_edges under a fresh project id. Asset/generation history
// is NOT cloned — the copy references the same assets as the original.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const sql = getDb()
    const { projectId } = await params

    const original = await sql`
      SELECT name, description, thumbnail
      FROM projects
      WHERE id = ${projectId}
    `
    if (original.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const newId = uuidv4()
    const newName = `${original[0].name} (Copy)`

    const inserted = await sql`
      INSERT INTO projects (id, userid, name, description, thumbnail, createdat, updatedat)
      VALUES (
        ${newId},
        ${DEFAULT_USER_ID},
        ${newName},
        ${original[0].description || ''},
        ${original[0].thumbnail || null},
        NOW(),
        NOW()
      )
      RETURNING id, name, description, thumbnail, createdat, updatedat
    `

    // Copy canvas in one shot per table — the (projectId, nodeId/edgeId)
    // composite PK already includes the new projectId, so collisions are
    // impossible and we keep the original node/edge ids for in-data references.
    await sql`
      INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
      SELECT ${newId}::text, nodeId, type, position_x, position_y, data
      FROM canvas_nodes
      WHERE projectId = ${projectId}::text
    `
    await sql`
      INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
      SELECT ${newId}::text, edgeId, source, target, sourceHandle, targetHandle, animated, data
      FROM canvas_edges
      WHERE projectId = ${projectId}::text
    `

    return NextResponse.json(inserted[0])
  } catch (error) {
    console.error('[projects] Duplicate failed:', error)
    return NextResponse.json({ error: 'Failed to duplicate project' }, { status: 500 })
  }
}
