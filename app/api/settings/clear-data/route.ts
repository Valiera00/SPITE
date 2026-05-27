import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { type } = await request.json()

    if (type === 'canvas') {
      // Clear all canvas data (nodes, edges, projects)
      await sql`DELETE FROM canvas_edges`
      await sql`DELETE FROM canvas_nodes`
      await sql`DELETE FROM projects`
      
      return NextResponse.json({ success: true, message: 'All canvas data cleared' })
    }

    if (type === 'assets') {
      // Get all assets to find their R2 keys
      const assets = await sql`SELECT id, metadata FROM assets`
      
      // Delete from R2 if there are files
      if (assets.length > 0 && process.env.R2_BUCKET_NAME) {
        try {
          const s3Client = getS3Client()
          // List all objects in bucket to delete
          const listCommand = new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
          })
          const listResult = await s3Client.send(listCommand)
          
          if (listResult.Contents && listResult.Contents.length > 0) {
            const deleteCommand = new DeleteObjectsCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Delete: {
                Objects: listResult.Contents.map(obj => ({ Key: obj.Key })),
              },
            })
            await s3Client.send(deleteCommand)
          }
        } catch (r2Error) {
          console.error('[clear-data] R2 delete error:', r2Error)
          // Continue with database deletion even if R2 fails
        }
      }

      // Delete all assets from database
      await sql`DELETE FROM assets`
      
      return NextResponse.json({ success: true, message: 'All assets cleared' })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('[clear-data] Error:', error)
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 })
  }
}
