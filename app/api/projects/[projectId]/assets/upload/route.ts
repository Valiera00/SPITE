import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { NextRequest, NextResponse } from 'next/server'

const s3Client = new S3Client({
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
})

const sql = neon(process.env.DATABASE_URL!)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const formData = await req.formData()
    const file = formData.get('file') as File
    const name = formData.get('name') as string
    const category = formData.get('category') as string

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Generate unique filename
    const timestamp = Date.now()
    const filename = `${projectId}/${timestamp}-${file.name}`
    const buffer = await file.arrayBuffer()

    // Upload to R2
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: filename,
        Body: new Uint8Array(buffer),
        ContentType: file.type,
      })
    )

    // Get public URL
    const url = `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${filename}`

    // Save metadata to database
    const result = await sql`
      INSERT INTO assets (projectId, name, category, url, metadata)
      VALUES (${projectId}, ${name}, ${category}, ${url}, ${JSON.stringify({ filename, size: file.size, type: file.type })})
      RETURNING id, name, category, url, createdAt
    `

    return NextResponse.json(result[0], { status: 201 })
  } catch (error) {
    console.error('[v0] Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const { assetId, filename } = await req.json()

    // Delete from R2
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: filename,
      })
    )

    // Delete from database
    await sql`DELETE FROM assets WHERE id = ${assetId} AND projectId = ${projectId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
