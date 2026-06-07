import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { v4 as uuidv4 } from 'uuid'
import { ensureFoldersSchema } from '@/lib/folders-schema'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// GET /api/folders?projectId=<id>[&type=character|prop|location|general]
//
// Two-step query. First pull all folder rows for the project, then pull
// every asset_folder_items row that belongs to one of those folders
// (joined to generation_history for the thumbnail URL etc.), then stitch
// items into their folder client-side. This avoids the json_agg /
// COALESCE pattern that was 500'ing on prod, and the schema is all text
// so no type-cast contortions are needed.
export async function GET(request: NextRequest) {
  try {
    const sql = getDb()
    await ensureFoldersSchema(sql)
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const type = searchParams.get('type')

    // Callers always know their project context — refuse to leak across.
    if (!projectId) return NextResponse.json([])

    const folders = type
      ? await sql`
          SELECT id, project_id, type, name, description, created_at, updated_at
          FROM asset_folders
          WHERE project_id = ${projectId} AND type = ${type}
          ORDER BY name ASC
        `
      : await sql`
          SELECT id, project_id, type, name, description, created_at, updated_at
          FROM asset_folders
          WHERE project_id = ${projectId}
          ORDER BY type, name ASC
        `

    if (folders.length === 0) {
      console.log('[folders] GET', { projectId, type, returned: 0 })
      return NextResponse.json([])
    }

    const folderIds = folders.map(f => String(f.id))
    const items = await sql`
      SELECT i.folder_id, i.asset_id, i.added_at,
             g.r2_url, g.type AS asset_type, g.prompt
      FROM asset_folder_items i
      LEFT JOIN generation_history g ON g.id = i.asset_id
      WHERE i.folder_id = ANY(${folderIds}::text[])
      ORDER BY i.added_at DESC
    `

    const itemsByFolder = new Map<string, any[]>()
    for (const row of items) {
      const fid = String(row.folder_id)
      if (!itemsByFolder.has(fid)) itemsByFolder.set(fid, [])
      itemsByFolder.get(fid)!.push({
        id: row.asset_id,
        r2_url: row.r2_url,
        type: row.asset_type,
        prompt: row.prompt,
      })
    }

    const result = folders.map(f => ({
      ...f,
      assets: itemsByFolder.get(String(f.id)) || [],
    }))

    console.log('[folders] GET', { projectId, type, returned: result.length })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[folders] GET error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch folders' },
      { status: 500 },
    )
  }
}

// POST /api/folders
// Body: { name, type, description?, projectId, assetIds? }
export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    await ensureFoldersSchema(sql)
    const { name, description, type, projectId, assetIds = [] } = await request.json()

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 })
    }
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const id = uuidv4()
    console.log('[folders] POST creating', { id, name, type, projectId, assetCount: assetIds.length })

    await sql`
      INSERT INTO asset_folders (id, project_id, type, name, description)
      VALUES (${id}, ${projectId}, ${type}, ${name}, ${description || null})
    `

    for (const assetId of assetIds) {
      if (!assetId) continue
      // INSERT … ON CONFLICT DO NOTHING — same asset can't appear twice in
      // the same folder thanks to the composite primary key.
      await sql`
        INSERT INTO asset_folder_items (folder_id, asset_id)
        VALUES (${id}, ${assetId})
        ON CONFLICT (folder_id, asset_id) DO NOTHING
      `
      // Auto-protect the asset so it survives canvas cleanup until the
      // user explicitly deletes it from the library.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = true, expires_at = NULL
        WHERE id = ${assetId}
      `
    }

    return NextResponse.json({ success: true, id })
  } catch (err: any) {
    console.error('[folders] POST error:', err)
    return NextResponse.json(
      { error: 'Failed to create folder' },
      { status: 500 },
    )
  }
}
