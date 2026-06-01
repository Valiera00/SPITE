import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// Lazy initialization - only create connection when needed
function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Default user ID for now (no auth)
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { name, description } = await request.json()
    const projectId = uuidv4()

    const result = await sql`
      INSERT INTO projects (id, userid, name, description, createdat, updatedat)
      VALUES (${projectId}, ${DEFAULT_USER_ID}, ${name || 'Untitled Project'}, ${description || ''}, NOW(), NOW())
      RETURNING id, name, description, thumbnail, createdat, updatedat
    `

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[projects] Error creating project:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const sql = getDb()
    // Pull each project plus the URL of its "shot 1" node, if any. The
    // LATERAL join finds the first canvas_node whose data.shotId is
    // 'shot-1' for that project and returns whichever URL field it has
    // (image outputUrl, video poster, or raw thumbnail). Falling back to
    // the project's own thumbnail column lets explicit overrides work
    // too. Sorted by updatedat DESC so the most recently edited project
    // surfaces at the top.
    const projects = await sql`
      SELECT
        p.id,
        p.name,
        p.description,
        COALESCE(shot1.thumb, p.thumbnail) AS thumbnail,
        p.createdat,
        p.updatedat
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          data->>'outputUrl',
          data->>'videoThumbnail',
          data->>'thumbnail',
          data->>'assetUrl'
        ) AS thumb
        FROM canvas_nodes
        WHERE projectId = p.id::text
          AND data->>'shotId' = 'shot-1'
          AND COALESCE(
            data->>'outputUrl',
            data->>'videoThumbnail',
            data->>'thumbnail',
            data->>'assetUrl'
          ) IS NOT NULL
        LIMIT 1
      ) shot1 ON true
      ORDER BY p.updatedat DESC
    `

    return NextResponse.json(projects)
  } catch (error) {
    console.error('[projects] Error fetching projects:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}
