import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import {
  getR2Client,
  verifyImageToken,
  isThumbnailable,
  thumbKeyFor,
  THUMB_WIDTH,
} from '@/lib/r2-upload'
import { SESSION_COOKIE_NAME, isSessionValid } from '@/lib/sessions'

// Return the stored thumbnail for `key`, generating and storing it on first
// request. Returns null on any failure (missing original, undecodable image,
// R2 error) so the caller can fall back to serving the original — a
// thumbnail problem must never turn into a broken image.
async function getOrCreateThumbnail(key: string): Promise<Buffer | null> {
  const client = getR2Client()
  const Bucket = process.env.R2_BUCKET_NAME!
  const thumbKey = thumbKeyFor(key)
  try {
    const existing = await client.send(new GetObjectCommand({ Bucket, Key: thumbKey }))
    const bytes = await existing.Body?.transformToByteArray()
    if (bytes?.length) return Buffer.from(bytes)
  } catch {
    // Not generated yet (NoSuchKey) — fall through and make it.
  }
  try {
    const original = await client.send(new GetObjectCommand({ Bucket, Key: key }))
    const bytes = await original.Body?.transformToByteArray()
    if (!bytes?.length) return null
    // fit 'outside': the SHORTER side lands on THUMB_WIDTH, so a square
    // object-cover tile stays sharp whatever the source aspect ratio.
    // rotate() with no args applies EXIF orientation before the strip.
    const thumb = await sharp(Buffer.from(bytes))
      .rotate()
      .resize(THUMB_WIDTH, THUMB_WIDTH, { fit: 'outside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer()
    await client.send(
      new PutObjectCommand({ Bucket, Key: thumbKey, Body: thumb, ContentType: 'image/webp' }),
    )
    return thumb
  } catch (err) {
    console.error('[R2 Image Proxy] thumbnail failed for', key, err)
    return null
  }
}

// Filename for Content-Disposition. The client-supplied name is untrusted and
// lands inside a quoted header value, so keep only characters that can't
// break out of it; always end in the real object's extension.
function safeDownloadName(requested: string, key: string): string {
  const ext = (key.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const base = requested
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .trim()
    .slice(0, 80)
  const fallback = (key.split('/').pop() || 'download').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^a-zA-Z0-9_.-]/g, '')
  return `${base || fallback || 'download'}.${ext || 'bin'}`
}

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

    // Cookie-authenticated reads (the app's own <img>/<video> loads) get a
    // 302 to a short-lived presigned R2 URL instead of having their bytes
    // streamed back through this function. Streaming every view through the
    // function bills the full file size as Vercel "Fast Origin Transfer" on
    // EVERY load — a canvas of 30 media files reopened a few times is
    // gigabytes, enough to pause a Hobby project. Redirecting hands the
    // download straight to Cloudflare (R2 egress is free) and only a tiny
    // redirect crosses Vercel. The presigned URL is itself a time-limited
    // capability, so the bucket stays private; we mark the redirect no-store
    // so the URL is never parked in a shared cache.
    //
    // The signed-token (fal.ai) path deliberately keeps streaming below: fal's
    // image fetcher requires `Access-Control-Allow-Origin: *`, which we can
    // only guarantee from this function, not from a raw R2 presigned URL.
    if (!signedAuth) {
      // Grid thumbnail (?w=…). The one cookie-auth case that DOES send bytes
      // through this function — deliberately. A thumbnail is ~30KB, not the
      // multi-MB original, and serving it from this stable URL lets it carry
      // a year-long private cache header. The redirect path can't do that:
      // every redirect mints a different presigned URL, so the browser never
      // gets a cache hit and re-downloads the original on every panel open.
      // Falls through to the normal redirect if the thumbnail can't be made.
      if (searchParams.has('w') && isThumbnailable(key)) {
        const thumb = await getOrCreateThumbnail(key)
        if (thumb) {
          return new NextResponse(new Uint8Array(thumb), {
            headers: {
              'Content-Type': 'image/webp',
              'X-Content-Type-Options': 'nosniff',
              // private: cookie-authenticated, so never a shared/CDN cache.
              // immutable: a key's content never changes once written.
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          })
        }
      }

      // Raw bytes (?bytes=1), same-origin. The photo editor has to draw the
      // image on a canvas and read its pixels back; an image that arrived via
      // the cross-origin redirect taints the canvas and getImageData throws.
      // Streaming it from here keeps it same-origin. Full-size bytes do cross
      // Vercel on this path, but only when someone opens the editor — never
      // for display.
      if (searchParams.has('bytes')) {
        const obj = await getR2Client().send(
          new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
        )
        const bytes = await obj.Body?.transformToByteArray()
        if (!bytes) return NextResponse.json({ error: 'File not found' }, { status: 404 })
        return new NextResponse(new Uint8Array(bytes), {
          headers: {
            'Content-Type': obj.ContentType || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
          },
        })
      }

      // Download (?download=<filename>). `<a download>` is ignored once the
      // request redirects cross-origin to R2, so the browser used to navigate
      // to the file instead of saving it. Asking R2 to answer with
      // Content-Disposition: attachment makes it a real download that never
      // leaves the page — and the bytes still go straight from R2.
      const downloadName = searchParams.get('download')
      const disposition = downloadName !== null
        ? `attachment; filename="${safeDownloadName(downloadName, key)}"`
        : undefined

      // 1h expiry: long enough that a <video> paused then scrubbed later
      // won't hit an expired URL mid-playback, short enough to bound the
      // capability if the redirect URL ever leaks.
      const presignedUrl = await getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: key,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn: 3600 },
      )
      return new NextResponse(null, {
        status: 302,
        headers: { Location: presignedUrl, 'Cache-Control': 'private, no-store' },
      })
    }

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })

    const response = await getR2Client().send(command)
    const buffer = await response.Body?.transformToByteArray()

    if (!buffer) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Only signed-token (fal.ai) requests reach this streaming path now —
    // cookie reads were redirected to a presigned URL above. The signature
    // lives in the URL, so the URL itself is the capability: safe to cache
    // publicly for up to 1 hour (matches the token's expiry), and fal's image
    // fetcher REQUIRES `Access-Control-Allow-Origin: *` or it returns "Failed
    // to download the file". Don't remove the ACAO on this path.
    const headers: Record<string, string> = {
      'Content-Type': response.ContentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
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
