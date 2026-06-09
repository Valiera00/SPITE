import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2-upload'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'

// Hand the browser a short-lived presigned URL that lets it PUT a file
// directly into our R2 bucket without round-tripping the bytes through
// Vercel's serverless function. The /api/r2-upload route is fine for
// tiny files but Vercel's body limit on the Hobby tier is 4.5 MB, so
// anything bigger died with HTTP 413 before this existed.
//
// Flow: client POSTs { filename, contentType } here → we return
// { presignedUrl, key, proxyUrl }. Client then does PUT presignedUrl
// with the file body. After success, the client POSTs /api/assets
// with proxyUrl to record the asset (same as before).
//
// CORS — set it ONCE in the Cloudflare R2 dashboard, do not manage it
// at runtime from here. The previous self-healing-CORS code (commit
// 53f0515) tried to keep the bucket rule current by calling
// PutBucketCors on every cold start, but `PutBucketCors` requires the
// R2 API token to have bucket-level admin permissions — most users
// generate "Object Read & Write" tokens that can't write the rule and
// the catch block swallowed the permission error silently. Net effect:
// the rule never updated, every new preview deploy died with
// "Failed to fetch", and the previous engineer (me) kept blaming
// content types and origin patterns. See README install steps for the
// CORS JSON to paste into the R2 dashboard once.

export async function POST(req: NextRequest) {
  try {
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCOUNT_ID) {
      return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
    }

    const { filename, contentType } = await req.json()
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename required' }, { status: 400 })
    }

    const safeName = filename.replace(/[^\w.\-]+/g, '_')
    const key = `uploads/${Date.now()}-${safeName}`
    const client = getR2Client()

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    })

    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 300 })

    return NextResponse.json({
      presignedUrl,
      key,
      // Cookie-auth'd proxy path the rest of the app uses for r2 reads.
      proxyUrl: `/api/r2-image/${key}`,
    })
  } catch (err: any) {
    console.error('[r2-presign] error', err)
    return NextResponse.json(
      { error: 'presign failed' },
      { status: 500 },
    )
  }
}
