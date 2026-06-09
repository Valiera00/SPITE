import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'
import { getR2Client, verifyImageToken } from '@/lib/r2-upload'
import { SESSION_COOKIE_NAME, isSessionValid } from '@/lib/sessions'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

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
    } else {
      key = path.join('/')
    }

    const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
    const cookieOk = await isSessionValid(cookieToken)
    const { searchParams } = new URL(request.url)
    const queryTokenOk = verifyImageToken(key, searchParams.get('exp'), searchParams.get('sig'))
    if (!cookieOk && !pathTokenOk && !queryTokenOk) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Whether this request authenticated via an in-URL signature (path or
    // query token) rather than the session cookie. This decides cacheability:
    // a signed-token URL carries its own auth in the path/query, so the cache
    // key IS the auth and it's safe to mark public + CORS-open (fal.ai's image
    // fetcher needs both, and only ever uses signed URLs — never the cookie).
    // A cookie-authenticated request, by contrast, must NOT be stored in any
    // shared/CDN cache: the cache key is just the object key, so a cached copy
    // could be replayed to an unauthenticated caller. Serve those private.
    const signedAuth = pathTokenOk || queryTokenOk

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })

    const response = await getR2Client().send(command)
    const buffer = await response.Body?.transformToByteArray()

    if (!buffer) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Header strategy depends on how the request authenticated (see
    // `signedAuth` above):
    //
    //  - Signed-token requests (fal.ai): the signature lives in the URL, so
    //    the URL itself is the capability. Safe to cache publicly for up to
    //    1 hour (matches the token's expiry), and fal's image fetcher
    //    REQUIRES `Access-Control-Allow-Origin: *` or it returns "Failed to
    //    download the file". Don't remove the ACAO on this path.
    //
    //  - Cookie requests (the app's own <img> loads): same-origin, so no CORS
    //    header is needed, and the response must be marked private + no-store
    //    so no shared/CDN cache can replay private media to an unauthenticated
    //    caller (the cache key is only the object key, not the cookie).
    const headers: Record<string, string> = {
      'Content-Type': response.ContentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': signedAuth ? 'public, max-age=3600' : 'private, no-store',
    }
    if (signedAuth) {
      headers['Access-Control-Allow-Origin'] = '*'
    }
    return new NextResponse(buffer, { headers })
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
