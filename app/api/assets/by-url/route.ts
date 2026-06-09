import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
// Look up the generation_history asset id for a given r2 url, so the
// "Add to folder" flow can pre-select an asset on a legacy reference
// node that doesn't have data.assetId stored. Matches by key suffix to
// tolerate both proxy-form (/api/r2-image/...) and direct r2.dev URLs.
export async function GET(request: NextRequest) {
  try {
    const sql = getDb()
    const url = request.nextUrl.searchParams.get('url')
    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }
    const key = url.includes('/api/r2-image/')
      ? url.split('/api/r2-image/')[1]
      : url.includes('.r2.dev/')
      ? url.split('.r2.dev/')[1]
      : null
    const rows = key
      ? await sql`SELECT id FROM generation_history WHERE r2_url LIKE ${'%' + key} ORDER BY created_at DESC LIMIT 1`
      : await sql`SELECT id FROM generation_history WHERE r2_url = ${url} ORDER BY created_at DESC LIMIT 1`
    if (rows.length === 0) {
      return NextResponse.json({ id: null })
    }
    return NextResponse.json({ id: rows[0].id })
  } catch (error) {
    console.error('[assets/by-url] GET error:', error)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
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
