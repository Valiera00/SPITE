import { NextRequest, NextResponse } from 'next/server'
import { getR2Client, deleteThumbFor } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { timingSafeEqual } from 'crypto'
import { purgeExpiredSessions } from '@/lib/sessions'
import { purgeOldSpendLedger } from '@/lib/spend-gate'
import { getReferenceRetentionDays, getAssetRetentionDays, ensureProjectRetentionColumn } from '@/lib/retention'
import { logEvent } from '@/lib/events'

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
  // The derived thumbnail goes with its original.
  await deleteThumbFor(key)
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
  const days = await getReferenceRetentionDays()
  if (days <= 0) return 0
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
    // SAFETY — this is the ONLY query that deletes generated assets, and it must
    // only ever touch UNPROTECTED ones. Three independent conditions, all required:
    //   used_in_canvas = false      → never an asset that's on a canvas (protected).
    //                                  `= false` also excludes NULL, so an unknown
    //                                  protection state is treated as protected.
    //   expires_at IS NOT NULL      → protected/permanent assets have NULL expiry;
    //                                  this excludes them outright.
    //   expires_at < CURRENT_TIMESTAMP → only assets whose retention window has
    //                                  actually elapsed.
    // Do NOT relax any of these.
    //
    // A FOURTH condition, added with per-project windows: the project's
    // effective window must be > 0. A project set to "never" (0) — or every
    // project, when the global window is 0 — is skipped even if a row still
    // carries an old expires_at from before the setting changed. The timer is
    // never trusted on its own.
    //
    // And a FIFTH: only canvas projects. A Flow project has no canvas, so by
    // the letter of "not on a canvas" every result it ever made is unused —
    // when in fact those results ARE the project. They are never auto-deleted.
    await ensureProjectRetentionColumn(sql)
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'canvas'`
    const globalDays = await getAssetRetentionDays()
    const expiredAssets = await sql`
      SELECT gh.id, gh.r2_url, gh.type, gh.project_id,
             COALESCE(p.name, 'an unknown project') AS project_name
      FROM generation_history gh
      LEFT JOIN projects p ON p.id::text = gh.project_id::text
      WHERE gh.used_in_canvas = false
        AND gh.expires_at IS NOT NULL
        AND gh.expires_at < CURRENT_TIMESTAMP
        AND COALESCE(p.asset_retention_days, ${globalDays}) > 0
        AND COALESCE(p.origin, 'canvas') = 'canvas'
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

    // Then delete from database — ONLY the rows the SELECT above returned (by
    // id), and only if they still satisfy the same three guards at this
    // moment. Nothing that wasn't listed can be deleted here.
    const expiredIds = expiredAssets.map((a) => a.id as string)
    const result = expiredIds.length
      ? await sql`
          DELETE FROM generation_history
          WHERE id = ANY(${expiredIds}::text[])
            AND used_in_canvas = false
            AND expires_at IS NOT NULL
            AND expires_at < CURRENT_TIMESTAMP
          RETURNING id
        `
      : []

    console.log(`[cleanup] Deleted ${result.length} expired assets from R2 and database`)

    // Tell the user, per project: "Deleted 3 assets from Project X". Logged, not
    // toasted — nobody is watching at 04:00. The next page load shows it.
    const deletedIds = new Set(result.map((r) => r.id as string))
    const perProject = new Map<string, { name: string; images: number; videos: number }>()
    for (const a of expiredAssets) {
      if (!deletedIds.has(a.id as string)) continue
      const key = (a.project_id as string) || 'unknown'
      const e = perProject.get(key) || { name: a.project_name as string, images: 0, videos: 0 }
      if (a.type === 'video') e.videos++; else e.images++
      perProject.set(key, e)
    }
    for (const [projectId, e] of perProject) {
      const n = e.images + e.videos
      const what = e.videos && e.images ? `${n} assets` : e.videos ? `${n} video${n === 1 ? '' : 's'}` : `${n} image${n === 1 ? '' : 's'}`
      await logEvent('cleanup', `Deleted ${what} from ${e.name}`, {
        projectId,
        detail: { images: e.images, videos: e.videos, windowDays: globalDays },
      })
    }

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
      if (referencesDeleted) {
        console.log(`[cleanup] Reclaimed ${referencesDeleted} aged reference images`)
        await logEvent('cleanup', `Reclaimed ${referencesDeleted} reference image${referencesDeleted === 1 ? '' : 's'} older than ${await getReferenceRetentionDays()} days`)
      }
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
