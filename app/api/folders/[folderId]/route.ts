import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { ensureFoldersSchema } from '@/lib/folders-schema'

// GET /api/folders/[folderId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> },
) {
  try {
    const sql = getDb()
    await ensureFoldersSchema(sql)
    const { folderId } = await params

    const folders = await sql`
      SELECT id, project_id, type, name, description, created_at, updated_at
      FROM asset_folders
      WHERE id = ${folderId}
    `
    if (folders.length === 0) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    const items = await sql`
      SELECT i.asset_id, g.r2_url, g.type AS asset_type, g.prompt
      FROM asset_folder_items i
      LEFT JOIN generation_history g ON g.id = i.asset_id
      WHERE i.folder_id = ${folderId}
      ORDER BY i.added_at DESC
    `

    return NextResponse.json({
      ...folders[0],
      assets: items.map(r => ({
        id: r.asset_id,
        r2_url: r.r2_url,
        type: r.asset_type,
        prompt: r.prompt,
      })),
    })
  } catch (err: any) {
    console.error('[folders] GET single error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch folder' },
      { status: 500 },
    )
  }
}

// PATCH /api/folders/[folderId]
// Body: { name?, description?, addAssetIds?, removeAssetIds?, setAssetIds? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> },
) {
  try {
    const sql = getDb()
    await ensureFoldersSchema(sql)
    const { folderId } = await params
    const { name, description, addAssetIds, removeAssetIds, setAssetIds } = await request.json()

    if (name !== undefined || description !== undefined) {
      await sql`
        UPDATE asset_folders
        SET
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          updated_at = now()
        WHERE id = ${folderId}
      `
    }

    // Replace-all semantics: setAssetIds wipes existing items and inserts
    // the new list. Used by the edit flow.
    if (Array.isArray(setAssetIds)) {
      await sql`DELETE FROM asset_folder_items WHERE folder_id = ${folderId}`
      for (const assetId of setAssetIds) {
        if (!assetId) continue
        await sql`
          INSERT INTO asset_folder_items (folder_id, asset_id)
          VALUES (${folderId}, ${assetId})
          ON CONFLICT (folder_id, asset_id) DO NOTHING
        `
        await sql`
          UPDATE generation_history
          SET used_in_canvas = true, expires_at = NULL
          WHERE id = ${assetId}
        `
      }
    } else {
      if (Array.isArray(addAssetIds)) {
        for (const assetId of addAssetIds) {
          if (!assetId) continue
          await sql`
            INSERT INTO asset_folder_items (folder_id, asset_id)
            VALUES (${folderId}, ${assetId})
            ON CONFLICT (folder_id, asset_id) DO NOTHING
          `
          await sql`
            UPDATE generation_history
            SET used_in_canvas = true, expires_at = NULL
            WHERE id = ${assetId}
          `
        }
      }
      if (Array.isArray(removeAssetIds) && removeAssetIds.length > 0) {
        await sql`
          DELETE FROM asset_folder_items
          WHERE folder_id = ${folderId}
            AND asset_id = ANY(${removeAssetIds}::text[])
        `
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[folders] PATCH error:', err)
    return NextResponse.json(
      { error: 'Failed to update folder' },
      { status: 500 },
    )
  }
}

// DELETE /api/folders/[folderId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> },
) {
  try {
    const sql = getDb()
    await ensureFoldersSchema(sql)
    const { folderId } = await params
    // ON DELETE CASCADE on the FK handles the items table for us.
    await sql`DELETE FROM asset_folders WHERE id = ${folderId}`
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[folders] DELETE error:', err)
    return NextResponse.json(
      { error: 'Failed to delete folder' },
      { status: 500 },
    )
  }
}
