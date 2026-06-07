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

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })

    const response = await s3Client.send(command)
    const buffer = await response.Body?.transformToByteArray()

    if (!buffer) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Cache hardening:
    // - `private` not `public` so shared caches (CDNs, corporate proxies)
    //   never store a copy; only the requesting browser/agent does.
    // - 5 min instead of 1 year so a signed URL leaked via screenshot
    //   or browser history has a short replay window.
    // - No Access-Control-Allow-Origin: * — we don't want signed URLs
    //   embeddable from any third-party origin.
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': response.ContentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
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
