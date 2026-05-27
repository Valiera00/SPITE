import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    const result = await sql`
      SELECT id, name, description, thumbnail, createdAt, updatedAt
      FROM projects
      WHERE id = ${projectId}
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[v0] Error fetching project:', error)
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { name, description, thumbnail } = await request.json()

    const result = await sql`
      UPDATE projects
      SET name = ${name}, description = ${description || ''}, thumbnail = ${thumbnail || null}, updatedAt = NOW()
      WHERE id = ${projectId}
      RETURNING id, name, description, thumbnail, createdAt, updatedAt
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[v0] Error updating project:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    await sql`DELETE FROM projects WHERE id = ${projectId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Error deleting project:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
