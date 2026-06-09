import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const sql = getDb()
    const { projectId } = await params

    // Simple query - get all assets for project
    const assets = await sql`SELECT * FROM assets WHERE projectid = ${projectId} ORDER BY createdat DESC`
    
    return NextResponse.json(assets)
  } catch (error) {
    console.error('Asset list error:', error)
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { assetId, tags } = await req.json()

    // Update asset tags
    const result = await sql`
      UPDATE assets
      SET tags = ${tags}, updatedat = NOW()
      WHERE id = ${assetId}::uuid AND projectid = ${projectId}
      RETURNING id, name, tags, category, url
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('Asset update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
