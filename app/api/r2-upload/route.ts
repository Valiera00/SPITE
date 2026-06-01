import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

const s3Client = new S3Client({
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
})

export async function POST(req: NextRequest) {
  console.log('[R2 Upload] Starting upload...')
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const filename = formData.get('filename') as string || file.name

    console.log('[R2 Upload] File:', { name: filename, size: file?.size, type: file?.type })

    if (!file) {
      console.log('[R2 Upload] No file provided')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Check env vars
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCOUNT_ID) {
      console.error('[R2 Upload] Missing R2 env vars')
      return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const key = `uploads/${timestamp}-${filename}`
    const buffer = await file.arrayBuffer()

    console.log('[R2 Upload] Uploading to R2 key:', key)

    // Upload to R2
    await s3Client.send(
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
    return NextResponse.json({ error: 'Upload failed', details: String(error) }, { status: 500 })
  }
}
