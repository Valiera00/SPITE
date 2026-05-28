import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { neon } from '@neondatabase/serverless'
import crypto from 'crypto'

// Lazy initialization for database connection
function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Lazy initialization for R2 client
function getR2Client() {
  return new S3Client({
    region: 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Stop the SDK injecting x-amz-checksum-mode into presigned URLs — it
    // breaks fetches of those URLs on R2 (and intermittently on fal.ai).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

export async function uploadToR2(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  const key = `assets/${Date.now()}-${fileName}`
  const r2Client = getR2Client()

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  return `https://${process.env.R2_PUBLIC_URL}/${key}`
}

function extFromContentType(contentType: string, fallbackUrl: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  }
  const base = contentType.split(';')[0].trim().toLowerCase()
  if (map[base]) return map[base]
  // Fall back to the extension in the source URL, else a sane default.
  const urlExt = fallbackUrl.split('?')[0].split('.').pop()
  if (urlExt && urlExt.length <= 4) return urlExt.toLowerCase()
  return base.startsWith('video') ? 'mp4' : 'png'
}

// Download a (temporary) source URL — e.g. a fal.media output — and store it
// permanently in our R2 bucket. Returns the private proxy URL to use as the
// asset's r2_url so the file is truly owned and never expires.
export async function rehostToR2(sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch source for re-host: ${res.status}`)
  }
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await res.arrayBuffer())
  const ext = extFromContentType(contentType, sourceUrl)
  const key = `generations/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`

  const r2Client = getR2Client()
  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )

  // Served privately through the existing R2 proxy route.
  return `/api/r2-image/${key}`
}

// Signed, time-limited access to the /api/r2-image proxy so an external
// service (fal.ai) can fetch a private asset without a login cookie. This is
// more reliable than R2 presigned URLs, which some fal endpoints fail to fetch.
function imageProxySecret(): string {
  return process.env.APP_PASSWORD || process.env.CRON_SECRET || 'frame-fallback-secret'
}

// Turn an internal proxy path (/api/r2-image/<key>) into an absolute,
// token-signed URL fal can fetch. Non-proxy URLs are returned unchanged.
// Token rides in the PATH (`/s/<exp>/<sig>/<key>`) instead of a query string
// so the URL ends in the asset's file extension — some fal validators (e.g.
// Kling 3.0's `elements.frontal_image_url`) reject URLs containing `?...`.
export function toFalFetchableUrl(
  url: string | null | undefined,
  baseUrl: string
): string | null | undefined {
  if (!url) return url
  const marker = '/api/r2-image/'
  const idx = url.indexOf(marker)
  if (idx === -1) return url // already an absolute, externally-fetchable URL
  const key = url.slice(idx + marker.length)
  const exp = Date.now() + 3600_000 // 1 hour
  const sig = crypto.createHmac('sha256', imageProxySecret()).update(`${key}:${exp}`).digest('hex')
  return `${baseUrl}/api/r2-image/s/${exp}/${sig}/${key}`
}

// Validate a token produced by toFalFetchableUrl, used by the proxy route.
export function verifyImageToken(key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false
  const e = Number(exp)
  if (!e || Date.now() > e) return false
  const expected = crypto.createHmac('sha256', imageProxySecret()).update(`${key}:${e}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

export async function recordAsset(
  type: 'image' | 'video',
  model: string,
  prompt: string,
  r2Url: string,
  projectId: string
) {
  const sql = getDb()
  const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await sql`
    INSERT INTO generation_history (id, type, model, prompt, r2_url, used_in_canvas, created_at, expires_at, project_id)
    VALUES (${id}, ${type}, ${model}, ${prompt}, ${r2Url}, false, CURRENT_TIMESTAMP, ${expiresAt}, ${projectId})
  `

  return id
}

export async function markAssetUsedInCanvas(assetId: string) {
  const sql = getDb()
  await sql`UPDATE generation_history SET used_in_canvas = true WHERE id = ${assetId}`
}
