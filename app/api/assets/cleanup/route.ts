import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
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

async function deleteFromR2(key: string) {
  try {
    const s3Client = getS3Client()
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      })
    )
  } catch (error) {
    console.error('[cleanup] R2 delete error:', error)
  }
}

// Cleanup job - should be called by Vercel cron job
export async function POST(request: NextRequest) {
  // Verify this is from Vercel cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sql = getDb()
    // Get expired assets that are NOT used in canvas
    const expiredAssets = await sql`
      SELECT id, r2_url FROM generation_history
      WHERE used_in_canvas = false
      AND expires_at < CURRENT_TIMESTAMP
    `

    // Delete from R2 first
    for (const asset of expiredAssets) {
      const url = asset.r2_url as string
      const keyMatch = url.match(/\/uploads\/[^/]+$/) || url.match(/\/api\/r2-image\/(.+)$/)
      if (keyMatch) {
        const key = keyMatch[0].startsWith('/api') ? keyMatch[1] : keyMatch[0].slice(1)
        await deleteFromR2(key)
      }
    }

    // Then delete from database
    const result = await sql`
      DELETE FROM generation_history
      WHERE used_in_canvas = false
      AND expires_at < CURRENT_TIMESTAMP
      RETURNING id
    `

    console.log(`[cleanup] Deleted ${result.length} expired assets from R2 and database`)

    return NextResponse.json({
      success: true,
      deleted: result.length,
    })
  } catch (error) {
    console.error('[cleanup] Error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
