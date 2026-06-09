import { S3Client, PutObjectCommand, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextRequest, NextResponse } from 'next/server'

// Hand the browser a short-lived presigned URL that lets it PUT a file
// directly into our R2 bucket without round-tripping the bytes through
// Vercel's serverless function. The /api/r2-upload route is fine for
// tiny files but Vercel's body limit on the Hobby tier is 4.5 MB, so
// anything bigger died with HTTP 413 before this existed.
//
// Flow: client POSTs { filename, contentType } here → we return
// { presignedUrl, key, proxyUrl }. Client then does PUT presignedUrl
// with the file body. After success, the client POSTs /api/assets
// with proxyUrl to record the asset (same as before).

function getS3() {
  return new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Match the rest of the codebase — stop the SDK injecting
    // x-amz-checksum-mode into presigned URLs, which breaks R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

// Build the list of origins allowed to PUT directly into the bucket.
// AllowedOrigins:['*'] would let any website with a guessed object URL
// upload/read from R2 cross-origin, so we restrict to the actual deploy
// URLs + localhost for dev. Override via ALLOWED_ORIGINS (comma-sep).
function getAllowedOrigins(): string[] {
  const origins = new Set<string>()
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origins.add(process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ''))
  }
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL}`)
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  }
  const extra = process.env.ALLOWED_ORIGINS
  if (extra) {
    for (const o of extra.split(',')) {
      const t = o.trim()
      if (t) origins.add(t)
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000')
  }
  return Array.from(origins)
}

// Decide if an origin is allowed to be added to the bucket CORS rule.
// We accept anything matching an env-configured entry verbatim, plus
// HTTPS Vercel preview/production URLs (which is where the legitimate
// drift comes from). Anything else stays out — preventing a logged-in
// user being tricked into clicking attacker.example.com and silently
// extending our bucket's allow-list to include their origin.
function isSafeOrigin(origin: string, configured: Set<string>): boolean {
  if (configured.has(origin)) return true
  try {
    const url = new URL(origin)
    if (url.protocol === 'http:' && url.hostname === 'localhost') return true
    if (url.protocol !== 'https:') return false
    if (url.hostname.endsWith('.vercel.app')) return true
  } catch {}
  return false
}

// Self-healing CORS. R2 buckets ship CORS-locked and have exactly one
// rule that gets replaced on every PutBucketCors. The previous code
// PUT a rule containing just `getAllowedOrigins()` on the first
// presign of each cold start — which clobbered any other preview /
// production deployment's origin from the rule. New preview deploys
// effectively kicked older ones out of their own bucket; that's the
// "Failed to fetch" the user kept hitting.
//
// New behaviour:
//   1. On the first call of this serverless instance, GET the
//      bucket's current CORS rule and seed our in-memory allow-set
//      from it (so we don't clobber whatever other deploys already
//      put there).
//   2. Add the env-configured origins to the set.
//   3. Add the requesting origin if it passes isSafeOrigin.
//   4. If we added anything not already present in the bucket's rule,
//      PUT the union back. Origins ACCUMULATE; no deploy uninvites
//      another.
//
// The bucket rule grows monotonically across deploys. There's no
// "stale" branch that gets uninvited the moment the next preview ships.
let corsInitialized = false
const corsAllowed = new Set<string>()

async function ensureBucketCorsForRequest(
  client: S3Client,
  requestOrigin: string | null,
) {
  const configured = new Set(getAllowedOrigins())
  let dirty = false

  if (!corsInitialized) {
    // Seed from the bucket's existing rule, so other deploys' origins
    // are preserved across the PUT we're about to do.
    try {
      const current = await client.send(new GetBucketCorsCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
      }))
      for (const rule of current.CORSRules ?? []) {
        for (const o of rule.AllowedOrigins ?? []) corsAllowed.add(o)
      }
    } catch {
      // No CORS rule yet (or transient fetch failure). Either way we
      // proceed with whatever we have; the PUT below installs a rule
      // for the first time.
    }
    for (const o of configured) {
      if (!corsAllowed.has(o)) {
        corsAllowed.add(o)
        dirty = true
      }
    }
    corsInitialized = true
  }

  if (
    requestOrigin &&
    isSafeOrigin(requestOrigin, configured) &&
    !corsAllowed.has(requestOrigin)
  ) {
    corsAllowed.add(requestOrigin)
    dirty = true
  }

  if (!dirty) return
  if (corsAllowed.size === 0) {
    console.warn(
      '[r2-presign] no allowed origins resolved; leaving existing CORS rule in place. Set NEXT_PUBLIC_SITE_URL or VERCEL_URL.',
    )
    return
  }

  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedOrigins: Array.from(corsAllowed),
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }))
    console.log('[r2-presign] CORS allow-list extended:', Array.from(corsAllowed).join(', '))
  } catch (err) {
    // Don't block the presign. If CORS really matters for this request
    // the browser's PUT will fail and the catch in canvas-workspace
    // will surface a toast. Roll the failed origin out of the cache so
    // the next request retries.
    if (requestOrigin) corsAllowed.delete(requestOrigin)
    console.error('[r2-presign] failed to extend CORS:', err)
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.R2_BUCKET_NAME || !process.env.R2_ACCOUNT_ID) {
      return NextResponse.json({ error: 'R2 not configured' }, { status: 500 })
    }

    const { filename, contentType } = await req.json()
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename required' }, { status: 400 })
    }

    const safeName = filename.replace(/[^\w.\-]+/g, '_')
    const key = `uploads/${Date.now()}-${safeName}`
    const client = getS3()

    // Pull the requesting browser's origin out of the headers so we can
    // add it to the bucket CORS rule if it isn't already there. This is
    // how new Vercel preview deploys self-add to the allow-list instead
    // of getting uninvited by whichever deploy cold-started first.
    const requestOrigin = req.headers.get('origin')
    await ensureBucketCorsForRequest(client, requestOrigin)

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
    })

    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 300 })

    return NextResponse.json({
      presignedUrl,
      key,
      // Cookie-auth'd proxy path the rest of the app uses for r2 reads.
      proxyUrl: `/api/r2-image/${key}`,
    })
  } catch (err: any) {
    console.error('[r2-presign] error', err)
    return NextResponse.json(
      { error: 'presign failed' },
      { status: 500 },
    )
  }
}
