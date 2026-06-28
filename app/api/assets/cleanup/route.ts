import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { timingSafeEqual } from 'crypto'
import { purgeExpiredSessions } from '@/lib/sessions'
import { purgeOldSpendLedger } from '@/lib/spend-gate'

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
    console.error('[cleanup] R2 delete error:', error)
  }
}

// Reclaim reference images (the refs/ prefix) older than the configured
// retention window. Reference images are throwaway inputs, not deliverables —
// once they've aged out, "Reuse" can no longer re-attach them, which is the
// intended trade-off for not paying to store inputs forever.
//
// OPT-IN BY DESIGN: with REFERENCE_RETENTION_DAYS unset or <= 0 this does
// nothing, so a self-hosted install never silently deletes a user's data.
// Set REFERENCE_RETENTION_DAYS=7 on a deployment that wants weekly reclaim.
async function sweepOldReferences(): Promise<number> {
  const days = Number(process.env.REFERENCE_RETENTION_DAYS)
  if (!Number.isFinite(days) || days <= 0) return 0
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const s3 = getR2Client()
  const bucket = process.env.R2_BUCKET_NAME!
  let token: string | undefined
  let deleted = 0
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: 'refs/', ContinuationToken: token,
    }))
    for (const obj of res.Contents || []) {
      if (obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff) {
        await deleteFromR2(obj.Key)
        deleted++
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return deleted
}

// Cleanup job. Invoked either by Vercel Cron (which issues a GET with an
// auto-injected `Authorization: Bearer ${CRON_SECRET}` header) or by an
// external scheduler doing a POST with the same header — so we export both
// and share one implementation.
export async function GET(request: NextRequest) {
  return runCleanup(request)
}

export async function POST(request: NextRequest) {
  return runCleanup(request)
}

async function runCleanup(request: NextRequest) {
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

    // Opt-in reference reclaim (no-op unless REFERENCE_RETENTION_DAYS is set).
    let referencesDeleted = 0
    try {
      referencesDeleted = await sweepOldReferences()
      if (referencesDeleted) console.log(`[cleanup] Reclaimed ${referencesDeleted} aged reference images`)
    } catch (err) {
      console.error('[cleanup] reference sweep failed:', err)
    }

    return NextResponse.json({
      success: true,
      deleted: result.length,
      sessionsDeleted,
      attemptsDeleted,
      spendLedgerDeleted,
      referencesDeleted,
    })
  } catch (error) {
    console.error('[cleanup] Error:', error)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
