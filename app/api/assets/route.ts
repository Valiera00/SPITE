import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

async function deleteFromR2(key: string) {
  try {
    const s3Client = getR2Client()
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      })
    )
  } catch (error) {
    console.error('[assets] R2 delete error:', error)
  }
}

export async function GET(request: NextRequest) {
  try {
    const sql = getDb()
    const projectId = request.nextUrl.searchParams.get('projectId')

    // Self-heal: if the `recovered` column hasn't been created yet on
    // this database (it was added lazily by recordAsset, which only runs
    // when a NEW generation lands), the SELECT below would throw and
    // the catch would silently return an empty array — making the
    // entire asset library look empty. Run an idempotent ALTER so the
    // column always exists before we try to read it.
    await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`

    // If projectId is provided, get assets for that project.
    // COALESCE on `recovered` so existing rows from before the column
    // was added default to false instead of NULL.
    if (projectId) {
      const assets = await sql`
        SELECT id, type, model, prompt, r2_url, used_in_canvas,
               COALESCE(is_upload, false) as is_upload,
               COALESCE(recovered, false) as recovered,
               created_at
        FROM generation_history
        WHERE project_id = ${projectId}
          AND (used_in_canvas = true OR expires_at > CURRENT_TIMESTAMP OR expires_at IS NULL)
        ORDER BY created_at DESC
        LIMIT 500
      `
      return NextResponse.json(assets)
    }

    // Otherwise, get all assets from all projects (library view)
    const assets = await sql`
      SELECT id, type, model, prompt, r2_url, used_in_canvas,
             COALESCE(is_upload, false) as is_upload,
             COALESCE(recovered, false) as recovered,
             created_at
      FROM generation_history
      WHERE (used_in_canvas = true OR expires_at > CURRENT_TIMESTAMP OR expires_at IS NULL)
      ORDER BY created_at DESC
      LIMIT 500
    `
    return NextResponse.json(assets)
  } catch (error) {
    console.error('[assets] List error:', error)
    return NextResponse.json([], { status: 200 })
  }
}

// Record a user upload (or reactivate existing asset with same URL)
export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { url, type, filename, projectId } = await request.json()
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }
    
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }
    
    // Check if asset with this URL already exists for this project
    const existing = await sql`
      SELECT id FROM generation_history WHERE r2_url = ${url} AND project_id = ${projectId} LIMIT 1
    `
    
    if (existing.length > 0) {
      // Reactivate existing asset instead of creating duplicate
      await sql`
        UPDATE generation_history 
        SET used_in_canvas = true, expires_at = NULL 
        WHERE id = ${existing[0].id}
      `
      return NextResponse.json({ success: true, id: existing[0].id, reactivated: true })
    }
    
    // Create new asset record
    const id = uuidv4()
    const result = await sql`
      INSERT INTO generation_history (id, type, model, prompt, r2_url, is_upload, used_in_canvas, expires_at, project_id)
      VALUES (${id}, ${type || 'image'}, 'upload', ${filename || 'User upload'}, ${url}, true, true, NULL, ${projectId})
      RETURNING id
    `
    
    return NextResponse.json({ success: true, id: result[0].id })
  } catch (error) {
    console.error('[assets] Upload record error:', error)
    return NextResponse.json({ error: 'Failed to record upload' }, { status: 500 })
  }
}

// Delete an asset (permanent)
export async function DELETE(request: NextRequest) {
  try {
    const sql = getDb()
    const { id } = await request.json()
    
    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
    }
    
    // Get the asset to find R2 key before deleting
    const asset = await sql`SELECT r2_url FROM generation_history WHERE id = ${id}`
    
    if (asset.length > 0 && asset[0].r2_url) {
      // Extract R2 key from URL - format is /uploads/{timestamp}-{filename}
      const url = asset[0].r2_url as string
      const keyMatch = url.match(/\/uploads\/[^/]+$/) || url.match(/\/api\/r2-image\/(.+)$/)
      if (keyMatch) {
        const key = keyMatch[0].startsWith('/api') ? keyMatch[1] : keyMatch[0].slice(1)
        await deleteFromR2(key)
      }
    }
    
    // Delete from database after R2 deletion
    await sql`DELETE FROM generation_history WHERE id = ${id}`
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[assets] Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
  }
}
