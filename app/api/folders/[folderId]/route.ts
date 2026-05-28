import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Get single folder
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const sql = getDb()
    const { folderId } = await params

    // Two-step query — see the list-folders GET for why we avoid the
    // single-shot json_agg / COALESCE pattern.
    const folderRows = await sql`
      SELECT id, project_id, name, description, type, created_at, updated_at
      FROM asset_folders
      WHERE id = ${folderId}
    `

    if (folderRows.length === 0) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    const items = await sql`
      SELECT fi.asset_id, fi.created_at,
             gh.r2_url, gh.type AS asset_type, gh.prompt
      FROM asset_folder_items fi
      LEFT JOIN generation_history gh ON fi.asset_id = gh.id
      WHERE fi.folder_id = ${folderId}
      ORDER BY fi.created_at DESC
    `
    const assets = items.map(r => ({
      id: r.asset_id,
      r2_url: r.r2_url,
      type: r.asset_type,
      prompt: r.prompt,
    }))

    return NextResponse.json({ ...folderRows[0], assets })
  } catch (error: any) {
    console.error('[folders] GET single error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch folder', detail: error?.message || String(error) },
      { status: 500 },
    )
  }
}

// Update folder (name, description) or add/remove/set assets
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const sql = getDb()
    const { folderId } = await params
    const { name, description, addAssetIds, removeAssetIds, setAssetIds } = await request.json()

    // Update name/description if provided
    if (name !== undefined || description !== undefined) {
      await sql`
        UPDATE asset_folders 
        SET 
          name = COALESCE(${name}, name),
          description = COALESCE(${description}, description),
          updated_at = NOW()
        WHERE id = ${folderId}
      `
    }

    // Set assets (replace all)
    if (setAssetIds !== undefined) {
      // Remove all existing
      await sql`DELETE FROM asset_folder_items WHERE folder_id = ${folderId}`
      
      // Add new ones
      for (const assetId of setAssetIds) {
        await sql`
          INSERT INTO asset_folder_items (folder_id, asset_id)
          VALUES (${folderId}, ${assetId})
        `
        // Mark asset as protected
        await sql`
          UPDATE generation_history 
          SET used_in_canvas = true, expires_at = NULL 
          WHERE id = ${assetId}
        `
      }
    } else {
      // Add assets
      if (addAssetIds && addAssetIds.length > 0) {
        for (const assetId of addAssetIds) {
          // Check if already in folder
          const existing = await sql`
            SELECT id FROM asset_folder_items 
            WHERE folder_id = ${folderId} AND asset_id = ${assetId}
          `
          if (existing.length === 0) {
            await sql`
              INSERT INTO asset_folder_items (folder_id, asset_id)
              VALUES (${folderId}, ${assetId})
            `
          }
          // Mark asset as protected
          await sql`
            UPDATE generation_history 
            SET used_in_canvas = true, expires_at = NULL 
            WHERE id = ${assetId}
          `
        }
      }

      // Remove assets
      if (removeAssetIds && removeAssetIds.length > 0) {
        for (const assetId of removeAssetIds) {
          await sql`
            DELETE FROM asset_folder_items 
            WHERE folder_id = ${folderId} AND asset_id = ${assetId}
          `
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[folders] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update folder' }, { status: 500 })
  }
}

// Delete folder
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const sql = getDb()
    const { folderId } = await params

    await sql`DELETE FROM asset_folders WHERE id = ${folderId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[folders] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 })
  }
}
