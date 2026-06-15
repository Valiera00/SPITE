import { NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { ListObjectsV2Command } from '@aws-sdk/client-s3'

// Report total R2 usage for the storage bar in Settings. Auth is enforced by
// middleware (session cookie). Sums object sizes by paging through the bucket —
// ListObjectsV2 returns at most 1000 keys per call, so we follow the
// continuation token to cover buckets of any size. Listing is cheap (Class A
// ops, 1M/month free) and only runs when the settings page is open.
export async function GET() {
  if (!process.env.R2_BUCKET_NAME) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
  }
  try {
    const s3 = getR2Client()
    let token: string | undefined
    let usedBytes = 0
    let objectCount = 0
    do {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        ContinuationToken: token,
      }))
      for (const obj of res.Contents || []) {
        usedBytes += obj.Size || 0
        objectCount += 1
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)

    return NextResponse.json({
      usedBytes,
      objectCount,
      // R2's free-tier storage allowance, the bar's reference point.
      freeTierBytes: 10 * 1024 * 1024 * 1024,
    })
  } catch (err) {
    console.error('[settings/storage] error:', err)
    return NextResponse.json({ error: 'Failed to read storage usage' }, { status: 500 })
  }
}
