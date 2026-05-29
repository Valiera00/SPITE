import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
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

function getS3() {
  return new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Match the rest of the codebase — stop the SDK injecting
    // x-amz-checksum-mode into presigned URLs, which breaks R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

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

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    })

    const presignedUrl = await getSignedUrl(getS3(), command, { expiresIn: 300 })

    return NextResponse.json({
      presignedUrl,
      key,
      // Cookie-auth'd proxy path the rest of the app uses for r2 reads.
      proxyUrl: `/api/r2-image/${key}`,
    })
  } catch (err: any) {
    console.error('[r2-presign] error', err)
    return NextResponse.json(
      { error: 'presign failed', detail: err?.message || String(err) },
      { status: 500 },
    )
  }
}
