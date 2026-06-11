import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

// Both branches of this endpoint are catastrophically destructive — one
// wipes every canvas + project, the other deletes every asset in R2 AND
// in the DB. To stop an accidental stray POST from doing that, the
// caller must include a typed confirmation matching the action they're
// taking. The frontend Settings UI prompts the user to type the phrase
// in a dialog before sending the request.
const CONFIRM_PHRASES = {
  canvas: 'DELETE ALL CANVAS DATA',
  assets: 'DELETE ALL ASSETS',
} as const

export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { type, confirm } = await request.json()

    const expected = (CONFIRM_PHRASES as Record<string, string>)[type]
    if (!expected) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }
    if (typeof confirm !== 'string' || confirm !== expected) {
      return NextResponse.json(
        {
          error:
            'confirmation required',
          message: `To proceed, POST { type, confirm: "${expected}" }`,
        },
        { status: 400 },
      )
    }

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
      
      // Delete from R2 if there are files. ListObjectsV2 returns at most 1000
      // keys per call and DeleteObjects accepts at most 1000 per call, so we
      // page through the whole bucket — the previous single-shot list silently
      // left everything past the first 1000 objects orphaned.
      if (assets.length > 0 && process.env.R2_BUCKET_NAME) {
        try {
          const s3Client = getR2Client()
          let token: string | undefined
          do {
            const listResult = await s3Client.send(new ListObjectsV2Command({
              Bucket: process.env.R2_BUCKET_NAME,
              ContinuationToken: token,
            }))
            const contents = listResult.Contents || []
            if (contents.length > 0) {
              await s3Client.send(new DeleteObjectsCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Delete: {
                  Objects: contents.map(obj => ({ Key: obj.Key })),
                  Quiet: true,
                },
              }))
            }
            token = listResult.IsTruncated ? listResult.NextContinuationToken : undefined
          } while (token)
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
