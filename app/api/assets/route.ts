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

// Schema setup runs ONCE per serverless instance, not on every request. The
// list endpoint used to fire an ALTER TABLE on every GET — DDL takes a table
// lock, so a single asset-panel load could stall behind any concurrent write
// to generation_history (e.g. the autosave asset-reconcile). The index makes
// the per-project, newest-first query fast instead of a full scan + sort.
let assetsSchemaReady = false
async function ensureAssetsSchema(sql: ReturnType<typeof getDb>) {
  if (assetsSchemaReady) return
  await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
  // refs: the reference-image proxy URLs used to produce this result, so the
  // mobile "Reuse" button can re-attach them even after a refresh. JSON array.
  await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS refs jsonb`
  await sql`CREATE INDEX IF NOT EXISTS idx_genhistory_project_created ON generation_history (project_id, created_at DESC)`
  assetsSchemaReady = true
}

export async function GET(request: NextRequest) {
  try {
    const sql = getDb()
    const projectId = request.nextUrl.searchParams.get('projectId')

    // Ensure the `recovered` column + the project/created_at index exist.
    // Cached so this runs once per instance instead of on every list request.
    await ensureAssetsSchema(sql)

    // If projectId is provided, get assets for that project.
    // COALESCE on `recovered` so existing rows from before the column
    // was added default to false instead of NULL.
    if (projectId) {
      const assets = await sql`
        SELECT id, type, model, prompt, r2_url, used_in_canvas,
               COALESCE(is_upload, false) as is_upload,
               COALESCE(recovered, false) as recovered,
               refs,
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
             refs,
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

// Attach the reference images used to produce a result, keyed by its output
// URL. Called right after a generation completes so "Reuse" can restore the
// same references later — including after a page reload, unlike in-memory state.
export async function PATCH(request: NextRequest) {
  try {
    const sql = getDb()
    const { url, refs, projectId } = await request.json()
    if (!url || !Array.isArray(refs)) {
      return NextResponse.json({ error: 'url and refs[] are required' }, { status: 400 })
    }
    await ensureAssetsSchema(sql)
    const clean = refs.filter((u) => typeof u === 'string').slice(0, 12)
    if (projectId) {
      await sql`UPDATE generation_history SET refs = ${JSON.stringify(clean)}::jsonb WHERE r2_url = ${url} AND project_id = ${projectId}`
    } else {
      await sql`UPDATE generation_history SET refs = ${JSON.stringify(clean)}::jsonb WHERE r2_url = ${url}`
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[assets] Set refs error:', error)
    return NextResponse.json({ error: 'Failed to set refs' }, { status: 500 })
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
