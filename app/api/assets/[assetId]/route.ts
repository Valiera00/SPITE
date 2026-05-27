import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

function getR2Client() {
  return new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  })
}

// Mark asset as protected (used in canvas)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const sql = getDb()
    const { assetId } = await params
    const { used_in_canvas } = await request.json()

    const isProtected = used_in_canvas ?? true
    const expiresAt = isProtected ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    await sql`
      UPDATE generation_history 
      SET used_in_canvas = ${isProtected}, expires_at = ${expiresAt}
      WHERE id = ${assetId}
    `
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[assets] Update error:', error)
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const sql = getDb()
    const { assetId } = await params

    // Get asset details to find R2 URL
    const asset = await sql`SELECT used_in_canvas, r2_url FROM generation_history WHERE id = ${assetId}`
    
    if (!asset[0]) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    
    if (asset[0]?.used_in_canvas) {
      return NextResponse.json({ error: 'Cannot delete assets used in canvases' }, { status: 403 })
    }

    // Delete from database first
    await sql`DELETE FROM generation_history WHERE id = ${assetId}`

    // Delete from R2 storage
    if (asset[0]?.r2_url) {
      try {
        // r2_url format: /api/r2-image/uploads/filename.png
        // R2 key format: uploads/filename.png
        const r2Url = asset[0].r2_url as string
        const key = r2Url.replace('/api/r2-image/', '')
        
        const s3Client = getR2Client()
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: key,
          })
        )
      } catch (r2Error) {
        console.error('[assets] R2 deletion failed:', r2Error)
        // Continue anyway - DB record is already deleted
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[assets] Delete error:', error)
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
  }
}
