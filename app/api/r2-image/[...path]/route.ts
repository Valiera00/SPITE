import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { verifyImageToken } from '@/lib/r2-upload'
import { SESSION_COOKIE_NAME, isSessionValid } from '@/lib/sessions'

const s3Client = new S3Client({
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params
    const ua = request.headers.get('user-agent') || ''
    const isFal = /fal/i.test(ua)

    // Two URL shapes are accepted:
    //   1. /api/r2-image/<key...>                  — browser, cookie-auth
    //   2. /api/r2-image/s/<exp>/<sig>/<key...>    — fal.ai, path-token (no
    //      query string so the URL ends in the file extension and passes
    //      strict validators like Kling 3.0's `elements`).
    //   (legacy `?exp=&sig=` query-token is also still accepted as fallback.)
    let key: string
    let pathTokenOk = false
    if (path[0] === 's' && path.length >= 4) {
      const exp = path[1]
      const sig = path[2]
      key = path.slice(3).join('/')
      pathTokenOk = verifyImageToken(key, exp, sig)
      if (isFal || !pathTokenOk) {
        // TEMP diagnostic: surface why fal's fetch might be failing.
        console.log('[r2-image] path-token request', {
          ua,
          pathTokenOk,
          keyLen: key.length,
          keyHasSpaces: /\s/.test(key),
          keyHasPlus: key.includes('+'),
          exp,
          expElapsedMs: Date.now() - Number(exp),
        })
      }
    } else {
      key = path.join('/')
    }

    const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
    const cookieOk = await isSessionValid(cookieToken)
    const { searchParams } = new URL(request.url)
    const queryTokenOk = verifyImageToken(key, searchParams.get('exp'), searchParams.get('sig'))
    if (!cookieOk && !pathTokenOk && !queryTokenOk) {
      console.warn('[r2-image] DENIED', { ua, key, pathTokenOk, cookieOk, queryTokenOk })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })

    let response
    try {
      response = await s3Client.send(command)
    } catch (s3err: any) {
      console.error('[r2-image] R2 GET failed', {
        ua,
        key,
        name: s3err?.name,
        code: s3err?.$metadata?.httpStatusCode,
        msg: s3err?.message,
      })
      return new NextResponse('R2 fetch failed', {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    const buffer = await response.Body?.transformToByteArray()

    if (!buffer) {
      console.warn('[r2-image] empty body for key', { ua, key })
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    console.log('[r2-image] served', { ua, key, bytes: buffer.byteLength, ct: response.ContentType })

    // fal's image fetcher REQUIRES Access-Control-Allow-Origin: * to
    // accept the response — without it, fal returns "Failed to download
    // the file" for any reference. Don't remove this without a path
    // for fal to opt in via its own origin.
    //
    // Cap cache at 1 hour to match the HMAC signature's expiry: an URL
    // that has expired by our auth check shouldn't continue to be
    // served from any cache.
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': response.ContentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[R2 Image Proxy] Error:', error)
    // Generic error to client (no leaking S3 error details, no caching
    // of error responses at any CDN/edge layer).
    return new NextResponse('Failed to fetch image', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
