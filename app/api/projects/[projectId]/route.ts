import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

function getS3Client() {
  return new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  })
}

// Extract the R2 object key from a stored asset URL. Mirrors the logic in
// app/api/assets/cleanup so we delete consistently across cleanup paths.
function keyFromUrl(url: string): string | null {
  const proxy = url.match(/\/api\/r2-image\/(.+)$/)
  if (proxy) return proxy[1]
  const uploads = url.match(/\/uploads\/[^/]+$/)
  if (uploads) return uploads[0].slice(1)
  return null
}

async function deleteR2Key(key: string) {
  try {
    const client = getS3Client()
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    }))
  } catch (err) {
    console.error('[projects] R2 delete failed for', key, err)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    const result = await sql`
      SELECT id, name, description, thumbnail, createdAt, updatedAt
      FROM projects
      WHERE id = ${projectId}
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[v0] Error fetching project:', error)
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { name, description, thumbnail } = await request.json()

    const result = await sql`
      UPDATE projects
      SET name = ${name}, description = ${description || ''}, thumbnail = ${thumbnail || null}, updatedAt = NOW()
      WHERE id = ${projectId}
      RETURNING id, name, description, thumbnail, createdAt, updatedAt
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(result[0])
  } catch (error) {
    console.error('[v0] Error updating project:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    // For each asset whose generation_history row points at this project,
    // decide whether to hard-delete it or to reassign its ownership to
    // another project that still references the same r2_url. This way
    // duplicates (which share r2_urls with their source project) never
    // lose their media when the source project is deleted.
    const assets = await sql`
      SELECT id, r2_url
      FROM generation_history
      WHERE project_id = ${projectId}
    ` as { id: string; r2_url: string | null }[]

    const exclusiveAssetIds: string[] = []
    const exclusiveKeys: string[] = []

    for (const asset of assets) {
      const url = asset.r2_url
      if (!url) {
        exclusiveAssetIds.push(asset.id)
        continue
      }
      // Look for the URL in any OTHER project's canvas_nodes data — either
      // as the generated outputUrl or the reference/upload thumbnail.
      const referrer = await sql`
        SELECT projectid
        FROM canvas_nodes
        WHERE projectid <> ${projectId}::text
          AND (data->>'outputUrl' = ${url} OR data->>'thumbnail' = ${url})
        LIMIT 1
      ` as { projectid: string }[]

      if (referrer.length === 0) {
        const key = keyFromUrl(url)
        if (key) exclusiveKeys.push(key)
        exclusiveAssetIds.push(asset.id)
      } else {
        // Shared — keep the file, transfer the DB row to the other project.
        await sql`
          UPDATE generation_history
          SET project_id = ${referrer[0].projectid}
          WHERE id = ${asset.id}
        `
      }
    }

    // Delete the R2 objects for exclusive assets in parallel; errors are
    // logged but never block the DB cleanup (orphan files are reaped by
    // the cleanup cron eventually).
    await Promise.all(exclusiveKeys.map(deleteR2Key))

    if (exclusiveAssetIds.length) {
      await sql`
        DELETE FROM generation_history
        WHERE id = ANY(${exclusiveAssetIds}::text[])
      `
    }

    // Tear down the canvas tables explicitly — they don't have ON DELETE
    // CASCADE on the project FK, and asset_folders/items keyed by
    // project_id should go with the project too.
    await sql`DELETE FROM asset_folder_items WHERE folder_id IN (SELECT id FROM asset_folders WHERE project_id = ${projectId})`
    await sql`DELETE FROM asset_folders WHERE project_id = ${projectId}`
    await sql`DELETE FROM assets WHERE projectid = ${projectId}`
    await sql`DELETE FROM canvas_edges WHERE projectid = ${projectId}::text`
    await sql`DELETE FROM canvas_nodes WHERE projectid = ${projectId}::text`
    await sql`DELETE FROM projects WHERE id = ${projectId}`

    return NextResponse.json({
      success: true,
      assetsDeleted: exclusiveAssetIds.length,
      assetsTransferred: assets.length - exclusiveAssetIds.length,
    })
  } catch (error) {
    console.error('[v0] Error deleting project:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
