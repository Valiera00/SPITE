import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Update asset status by URL (used when assetId is not stored on node)
export async function POST(request: NextRequest) {
  try {
    const sql = getDb()
    const { url, used_in_canvas } = await request.json()

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // The thumbnail URL may be a proxy URL (/api/r2-image/...) 
    // or a direct R2 URL - strip to just the key and match
    const key = url.includes('/api/r2-image/') 
      ? url.split('/api/r2-image/')[1] 
      : url.split('.r2.dev/')[1]

    let result
    if (key) {
      // Match by URL key suffix
      result = await sql`
        UPDATE generation_history 
        SET used_in_canvas = ${used_in_canvas ?? false},
            expires_at = ${used_in_canvas ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}
        WHERE r2_url LIKE ${'%' + key}
        RETURNING id
      `
    } else {
      // Exact match fallback
      result = await sql`
        UPDATE generation_history 
        SET used_in_canvas = ${used_in_canvas ?? false},
            expires_at = ${used_in_canvas ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}
        WHERE r2_url = ${url}
        RETURNING id
      `
    }

    return NextResponse.json({ success: true, updated: result.length })
  } catch (error) {
    console.error('[assets/by-url] Error:', error)
    return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 })
  }
}
