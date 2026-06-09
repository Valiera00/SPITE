import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

// Update mutable fields on an asset. Currently:
//   used_in_canvas — protection flag (true = never auto-delete)
//   recovered      — was this asset pulled back via the recovery flow?
//                    Lets the UI badge it with a blue Lifebuoy. The
//                    column is added idempotently in lib/r2-upload.ts.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const sql = getDb()
    const { assetId } = await params
    const body = await request.json()
    const { used_in_canvas, recovered } = body as {
      used_in_canvas?: boolean
      recovered?: boolean
    }

    if (used_in_canvas !== undefined) {
      const isProtected = used_in_canvas ?? true
      const expiresAt = isProtected ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await sql`
        UPDATE generation_history
        SET used_in_canvas = ${isProtected}, expires_at = ${expiresAt}
        WHERE id = ${assetId}
      `
    }

    if (recovered !== undefined) {
      // Guard for old databases that don't yet have the recovered
      // column — ALTER IF NOT EXISTS lets us self-migrate without
      // failing the request.
      await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
      await sql`
        UPDATE generation_history
        SET recovered = ${recovered}
        WHERE id = ${assetId}
      `
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[assets] Update error:', error)
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 })
  }
}

// DELETE /api/assets/[assetId]
//
// Behaviour requested by the user:
//   - Always succeed if invoked.
//   - First, remove the asset from every folder it sits in. Folder
//     membership alone is no longer a reason to refuse deletion.
//   - Then look at the actual canvas_nodes for this project: is the
//     asset's r2_url (outputUrl/thumbnail) or id referenced by any node?
//       * Yes → keep the generation_history row + R2 file alive. The
//         response surfaces { kept: true, removed_from_folders }.
//       * No  → hard-delete the row + the R2 object.
//
// (used_in_canvas is no longer the gate. That flag also goes true for
// folder members via the folder API, which made the gate fire even
// when the asset wasn't on a node — see the user report.)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const sql = getDb()
    const { assetId } = await params

    const asset = await sql`
      SELECT r2_url FROM generation_history WHERE id = ${assetId}
    ` as { r2_url: string | null }[]

    if (!asset[0]) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    const r2Url = asset[0].r2_url

    // Step 1: drop folder memberships unconditionally.
    const removedRows = await sql`
      DELETE FROM asset_folder_items WHERE asset_id = ${assetId}
      RETURNING folder_id
    ` as { folder_id: string }[]
    const removedFromFolders = removedRows.length

    // Step 2: is the asset still referenced by a canvas node anywhere?
    // We check both the assetId match and any of the two URL fields that
    // node data uses to point at media (outputUrl on generated nodes,
    // thumbnail on uploaded/reference nodes).
    const canvasRefs = r2Url
      ? await sql`
          SELECT 1 FROM canvas_nodes
          WHERE data->>'assetId'   = ${assetId}
             OR data->>'outputUrl' = ${r2Url}
             OR data->>'thumbnail' = ${r2Url}
          LIMIT 1
        `
      : await sql`
          SELECT 1 FROM canvas_nodes
          WHERE data->>'assetId' = ${assetId}
          LIMIT 1
        `

    if (canvasRefs.length > 0) {
      // Still on a node — keep the asset so the node doesn't lose its
      // media. Folder rows are already gone above. Demote protection
      // so it can age out normally if the node is later removed.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = true, expires_at = NULL
        WHERE id = ${assetId}
      `
      return NextResponse.json({
        success: true,
        kept: true,
        reason: 'still_on_canvas',
        removed_from_folders: removedFromFolders,
      })
    }

    // Step 3: not on a canvas — hard delete.
    await sql`DELETE FROM generation_history WHERE id = ${assetId}`

    if (r2Url) {
      try {
        // r2_url format: /api/r2-image/uploads/filename.png
        const key = r2Url.replace('/api/r2-image/', '')
        const s3 = getR2Client()
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: key,
        }))
      } catch (r2Error) {
        console.error('[assets] R2 deletion failed:', r2Error)
        // DB row is gone already; leftover R2 object is acceptable.
      }
    }

    return NextResponse.json({
      success: true,
      kept: false,
      removed_from_folders: removedFromFolders,
    })
  } catch (error: any) {
    console.error('[assets] Delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete asset' },
      { status: 500 },
    )
  }
}
