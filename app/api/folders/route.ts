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

    let folders
    if (type) {
      folders = await sql`
        SELECT f.*, 
          COALESCE(
            json_agg(
              json_build_object(
                'id', fi.asset_id,
                'r2_url', gh.r2_url,
                'type', gh.type,
                'prompt', gh.prompt
              ) ORDER BY fi.created_at DESC
            ) FILTER (WHERE fi.id IS NOT NULL), '[]'
          ) as assets
        FROM asset_folders f
        LEFT JOIN asset_folder_items fi ON f.id = fi.folder_id
        LEFT JOIN generation_history gh ON fi.asset_id = gh.id
        WHERE f.project_id = ${projectId} AND f.type = ${type}
        GROUP BY f.id
        ORDER BY f.name ASC
      `
    } else {
      folders = await sql`
        SELECT f.*, 
          COALESCE(
            json_agg(
              json_build_object(
                'id', fi.asset_id,
                'r2_url', gh.r2_url,
                'type', gh.type,
                'prompt', gh.prompt
              ) ORDER BY fi.created_at DESC
            ) FILTER (WHERE fi.id IS NOT NULL), '[]'
          ) as assets
        FROM asset_folders f
        LEFT JOIN asset_folder_items fi ON f.id = fi.folder_id
        LEFT JOIN generation_history gh ON fi.asset_id = gh.id
        WHERE f.project_id = ${projectId}
        GROUP BY f.id
        ORDER BY f.type, f.name ASC
      `
    }

    console.log('[folders] GET', { projectId, type, returned: folders.length })
    return NextResponse.json(folders)
  } catch (error) {
    console.error('[folders] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 })
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

    // Create the folder
    await sql`
      INSERT INTO asset_folders (id, project_id, name, description, type)
      VALUES (${id}, ${projectId}, ${name}, ${description || null}, ${type})
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
