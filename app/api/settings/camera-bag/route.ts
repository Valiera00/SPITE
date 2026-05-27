import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// GET - List all camera bag styles
export async function GET() {
  try {
    const sql = getDb()
    const styles = await sql`SELECT id, name, style, createdAt FROM camera_bag ORDER BY createdAt DESC`
    return NextResponse.json(Array.isArray(styles) ? styles : [])
  } catch (error) {
    console.error('[camera-bag] List error:', error)
    return NextResponse.json([], { status: 200 })
  }
}

// POST - Create new style
export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { name, style } = await request.json()

    if (!name || !style) {
      return NextResponse.json({ error: 'Name and style are required' }, { status: 400 })
    }

    const result = await sql`
      INSERT INTO camera_bag (name, style)
      VALUES (${name}, ${style})
      RETURNING id, name, style, createdAt
    `

    return NextResponse.json(result[0], { status: 201 })
  } catch (error) {
    console.error('[camera-bag] Create error:', error)
    return NextResponse.json({ error: 'Failed to create style' }, { status: 500 })
  }
}

// PUT - Update existing style
export async function PUT(request: NextRequest) {
  try {
    const sql = getDb()
    const { id, name, style } = await request.json()

    if (!id || !name || !style) {
      return NextResponse.json({ error: 'ID, name, and style are required' }, { status: 400 })
    }

    const result = await sql`
      UPDATE camera_bag
      SET name = ${name}, style = ${style}, updatedAt = NOW()
      WHERE id = ${id}
      RETURNING id, name, style, createdAt
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Style not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[camera-bag] Update error:', error)
    return NextResponse.json({ error: 'Failed to update style' }, { status: 500 })
  }
}

// DELETE - Remove style
export async function DELETE(request: NextRequest) {
  try {
    const sql = getDb()
    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    await sql`DELETE FROM camera_bag WHERE id = ${id}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[camera-bag] Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete style' }, { status: 500 })
  }
}
