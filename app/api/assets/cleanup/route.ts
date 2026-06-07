import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { timingSafeEqual } from 'crypto'
import { purgeExpiredSessions } from '@/lib/sessions'
import { purgeOldSpendLedger } from '@/lib/spend-gate'

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
  // Refuse to run if CRON_SECRET is missing. Without this guard the
  // `Bearer ${process.env.CRON_SECRET}` template would produce the
  // literal string "Bearer undefined", which any caller could match,
  // turning this destructive endpoint into a public no-auth route.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cleanup] CRON_SECRET not configured — refusing to run')
    return NextResponse.json(
      { error: 'Server not configured' },
      { status: 500 },
    )
  }
  const expected = Buffer.from(`Bearer ${cronSecret}`)
  const provided = Buffer.from(request.headers.get('authorization') || '')
  const ok =
    expected.length === provided.length && timingSafeEqual(expected, provided)
  if (!ok) {
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

    // Sweep auth/spend tables too — they grow forever otherwise and the
    // rate-limit lookups get slower over time. Errors here don't fail
    // the cron; asset cleanup is the primary job.
    let sessionsDeleted = 0
    let attemptsDeleted = 0
    let spendLedgerDeleted = 0
    try {
      const sweep = await purgeExpiredSessions()
      sessionsDeleted = sweep.sessions
      attemptsDeleted = sweep.attempts
      spendLedgerDeleted = await purgeOldSpendLedger()
    } catch (err) {
      console.error('[cleanup] auth/spend sweep failed:', err)
    }

    return NextResponse.json({
      success: true,
      deleted: result.length,
      sessionsDeleted,
      attemptsDeleted,
      spendLedgerDeleted,
    })
  } catch (error) {
    console.error('[cleanup] Error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
