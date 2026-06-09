import { PutObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'

export async function POST(req: NextRequest) {
  console.log('[R2 Upload] Starting upload...')
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const rawFilename = formData.get('filename') as string || file?.name || 'upload'

    console.log('[R2 Upload] File:', { name: rawFilename, size: file?.size, type: file?.type })

    if (!file) {
      console.log('[R2 Upload] No file provided')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Check env vars
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCOUNT_ID) {
      console.error('[R2 Upload] Missing R2 env vars')
      return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
    }

    // Sanitise the filename before it becomes part of the R2 key. Anything
    // that isn't [a-zA-Z0-9._-] collapses to `_`. Caps length so a malicious
    // upload can't bloat the key beyond reason, and strips path separators
    // (no directory traversal into other R2 prefixes). Preserves the
    // extension so the served Content-Type detection still works.
    const safeFilename = rawFilename
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'upload'

    // Generate unique filename
    const timestamp = Date.now()
    const key = `uploads/${timestamp}-${safeFilename}`
    const buffer = await file.arrayBuffer()

    console.log('[R2 Upload] Uploading to R2 key:', key)

    // Upload to R2
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: new Uint8Array(buffer),
        ContentType: file.type,
      })
    )

    // Return the authenticated proxy path — never a direct r2.dev /
    // r2.cloudflarestorage.com URL. Those bypass our HMAC gate and the
    // bucket would have to be world-readable for them to work.
    const url = `/api/r2-image/${key}`

    console.log('[R2 Upload] Success - URL:', url)
    return NextResponse.json({ url, key }, { status: 200 })
  } catch (error) {
    console.error('[R2 Upload] Error:', error)
    // Generic error to client — raw error.message could leak the
    // S3 endpoint, bucket name, or AWS SDK internals.
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
