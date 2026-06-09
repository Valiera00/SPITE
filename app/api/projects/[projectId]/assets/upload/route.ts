import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const sql = getDb()
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
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: filename,
        Body: new Uint8Array(buffer),
        ContentType: file.type,
      })
    )

    // Route reads through the authenticated proxy. The raw
    // r2.cloudflarestorage.com URL would bypass the HMAC gate entirely.
    const url = `/api/r2-image/${filename}`

    // Save metadata to database
    const result = await sql`
      INSERT INTO assets (projectId, name, category, url, metadata)
      VALUES (${projectId}, ${name}, ${category}, ${url}, ${JSON.stringify({ filename, size: file.size, type: file.type })})
      RETURNING id, name, category, url, createdAt
    `

    return NextResponse.json(result[0], { status: 201 })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { assetId, filename } = await req.json()

    // Delete from R2
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: filename,
      })
    )

    // Delete from database
    await sql`DELETE FROM assets WHERE id = ${assetId} AND projectId = ${projectId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
