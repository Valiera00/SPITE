import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { v4 as uuidv4 } from 'uuid'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Get all folders with their assets
export async function GET(request: NextRequest) {
  try {
    const sql = getDb()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // character, prop, location, general
    const projectId = searchParams.get('projectId')
    if (!projectId) {
      // Return an empty list rather than silently leaking another project's
      // folders via the old proj-001 fallback. Callers always know their
      // project context.
      return NextResponse.json([])
    }

    // Two-step query — simpler + more robust than a single join with an
    // aggregating COALESCE(json_agg(...), '[]') which started 500'ing on
    // some PostgreSQL setups (the '[]' literal failed to implicit-cast to
    // json against the aggregated json result). Fetch the folder rows
    // first, then fetch all their items in one round trip and stitch them
    // together client-side. Cheap because folder counts stay small.
    //
    // NOTE: project_id is a uuid column in the deployed schema, so we cast
    // the bound parameter to uuid to match — the prior text-cast attempt
    // didn't take effect (still 500'd with `operator does not exist:
    // uuid = text`), possibly because Neon binds the parameter before the
    // ::text cast applies. Casting the parameter side directly is reliable.
    const folderRows = type
      ? await sql`
          SELECT id, project_id, name, description, type, created_at, updated_at
          FROM asset_folders
          WHERE project_id = ${projectId}::uuid AND type = ${type}
          ORDER BY name ASC
        `
      : await sql`
          SELECT id, project_id, name, description, type, created_at, updated_at
          FROM asset_folders
          WHERE project_id = ${projectId}::uuid
          ORDER BY type, name ASC
        `

    let itemsByFolder = new Map<string, any[]>()
    if (folderRows.length > 0) {
      const folderIds = folderRows.map(f => String(f.id))
      const items = await sql`
        SELECT fi.folder_id, fi.asset_id, fi.created_at AS item_created_at,
               gh.r2_url, gh.type AS asset_type, gh.prompt
        FROM asset_folder_items fi
        LEFT JOIN generation_history gh ON fi.asset_id = gh.id
        WHERE fi.folder_id::text = ANY(${folderIds}::text[])
        ORDER BY fi.created_at DESC
      `
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
    }

    const folders = folderRows.map(f => ({
      ...f,
      assets: itemsByFolder.get(f.id as string) || [],
    }))

    console.log('[folders] GET', { projectId, type, returned: folders.length })
    return NextResponse.json(folders)
  } catch (error: any) {
    console.error('[folders] GET error:', error)
    // Surface the actual error message in the response body so we can see
    // it in browser devtools instead of just a generic 500.
    return NextResponse.json(
      { error: 'Failed to fetch folders', detail: error?.message || String(error) },
      { status: 500 },
    )
  }
}

// Create a new folder
export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const body = await request.json()
    const { name, description, type, projectId, assetIds = [] } = body

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 })
    }
    if (!projectId) {
      // Reject explicitly instead of silently falling back to a default
      // "proj-001" project — that's what hid created folders from the
      // sidebar (which fetches scoped to the real project id).
      console.error('[folders] POST missing projectId', { name, type })
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    console.log('[folders] creating', { name, type, projectId, assetCount: assetIds.length })

    const id = uuidv4()

    // Create the folder. Cast project_id to whatever the column actually is
    // — schemas in the wild have it as uuid in some installs, text in others.
    await sql`
      INSERT INTO asset_folders (id, project_id, name, description, type)
      VALUES (${id}, ${projectId}::uuid, ${name}, ${description || null}, ${type})
    `

    // Add initial assets if provided
    for (const assetId of assetIds) {
      await sql`
        INSERT INTO asset_folder_items (folder_id, asset_id)
        VALUES (${id}, ${assetId})
      `
      // Mark asset as protected
      await sql`
        UPDATE generation_history 
        SET used_in_canvas = true, expires_at = NULL 
        WHERE id = ${assetId}
      `
    }

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('[folders] POST error:', error)
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 })
  }
}
