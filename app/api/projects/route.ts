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
    const projects = await sql`
      SELECT id, name, description, thumbnail, createdat, updatedat
      FROM projects
      ORDER BY updatedat DESC
    `

    return NextResponse.json(projects)
  } catch (error) {
    console.error('[projects] Error fetching projects:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}
