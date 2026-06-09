import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getDb } from './db'
import crypto from 'crypto'

// Lazy R2 S3 client — exported so other routes don't reinvent the
// config (region 'auto', the Cloudflare endpoint URL, the checksum
// settings that stop the AWS SDK from injecting headers R2 rejects).
//
// Lazy on purpose: env vars must be present at call time, not module
// load time, so a misconfigured environment surfaces a clean error
// from getDb() / getR2Client() instead of a cryptic crash at import.
export function getR2Client(): S3Client {
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

// Hosts we trust to return generation output URLs. Anything outside this
// allowlist is rejected by rehostToR2 — otherwise an attacker who can
// influence a URL passed in (via recover/status routes that interpolate
// user-supplied model/requestId into the fal queue URL) could turn our
// server into a fetch primitive: point at 169.254.169.254 / localhost /
// internal Vercel endpoints and have the response stored in R2.
const REHOST_ALLOWED_HOSTS = [
  /^([a-z0-9-]+\.)?fal\.media$/i,
  /^([a-z0-9-]+\.)?fal\.ai$/i,
  /^([a-z0-9-]+\.)?fal\.run$/i,
  /^v[0-9]+\.fal\.media$/i,
]

function isAllowedRehostSource(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:') return false
    return REHOST_ALLOWED_HOSTS.some(re => re.test(u.hostname))
  } catch {
    return false
  }
}

// Download a (temporary) source URL — e.g. a fal.media output — and store it
// permanently in our R2 bucket. Returns the private proxy URL to use as the
// asset's r2_url so the file is truly owned and never expires. Refuses any
// host not on REHOST_ALLOWED_HOSTS — SSRF defence.
// Fetch a URL while re-validating the host on EVERY hop. `fetch` follows
// redirects by default, so validating only the initial URL leaves an SSRF
// hole: an allowed host (fal.media) that 3xx-redirects to an internal
// address would be followed blindly. We follow manually and re-check each
// Location against the allowlist before continuing.
async function fetchAllowedFollowingRedirects(
  startUrl: string,
  maxHops = 5,
): Promise<Response> {
  let url = startUrl
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isAllowedRehostSource(url)) {
      throw new Error('rehostToR2: source host not allowed')
    }
    const res = await fetch(url, { redirect: 'manual' })
    // 3xx with a Location → validate the next hop before following.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res // no Location to follow; let caller handle !ok
      url = new URL(loc, url).toString()
      continue
    }
    return res
  }
  throw new Error('rehostToR2: too many redirects')
}

export async function rehostToR2(sourceUrl: string): Promise<string> {
  if (!isAllowedRehostSource(sourceUrl)) {
    throw new Error('rehostToR2: source host not allowed')
  }
  const res = await fetchAllowedFollowingRedirects(sourceUrl)
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
// more reliable than R2 presigned URLs, which some fal endpoints fail to
// fetch. Prefer R2_PROXY_SIGNING_SECRET (dedicated, can be rotated without
// affecting other systems); fall back to APP_PASSWORD for existing deploys
// that haven't migrated to the dedicated var yet. No literal-string default
// — a public-knowledge fallback would let anyone mint signed URLs and
// exfiltrate the entire bucket.
// Dedicated signing secret for the legacy /api/r2-image HMAC path-token URLs.
// No APP_PASSWORD fallback: reusing the login password as an HMAC key couples
// two unrelated secrets, and the current fal flow hands out R2 presigned URLs
// (toFalFetchableUrl) rather than these tokens anyway. Returns null when
// unset — verifyImageToken then treats the token path as disabled and callers
// fall back to cookie auth, instead of throwing and breaking every image load.
function imageProxySecret(): string | null {
  return process.env.R2_PROXY_SIGNING_SECRET || null
}

// Turn an internal proxy path (/api/r2-image/<key>) into an absolute
// URL fal can fetch. Non-proxy URLs are returned unchanged.
//
// Uses R2 presigned URLs so fal fetches DIRECTLY from R2 (no Vercel
// function in the loop) — this bypasses Vercel Deployment Protection
// entirely. Previously we constructed our own HMAC-signed proxy URL
// pointing at the deployment, which broke any time the deployment was
// behind Vercel Auth (preview deploys with default protection) unless
// the user had set SITE_URL or VERCEL_PROJECT_PRODUCTION_URL.
//
// 1-hour expiry matches the previous proxy-token TTL.
//
// Trade-off: presigned URLs end in `?X-Amz-Algorithm=...&X-Amz-Credential=...`.
// Some fal models historically rejected query strings on specific
// reference fields (Kling 3.0's `elements.frontal_image_url`). If that
// bites again we'll need a per-field check that falls back to the
// path-token proxy URL for those.
export async function toFalFetchableUrl(
  url: string | null | undefined,
): Promise<string | null | undefined> {
  if (!url) return url
  const marker = '/api/r2-image/'
  const idx = url.indexOf(marker)
  if (idx === -1) return url // already absolute, externally-fetchable
  const key = url.slice(idx + marker.length)
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  })
  return await getSignedUrl(getR2Client(), command, { expiresIn: 3600 })
}

// Validate a token produced by toFalFetchableUrl, used by the proxy route.
export function verifyImageToken(key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false
  const secret = imageProxySecret()
  if (!secret) return false // token path disabled unless R2_PROXY_SIGNING_SECRET is set
  const e = Number(exp)
  if (!e || Date.now() > e) return false
  const expected = crypto.createHmac('sha256', secret).update(`${key}:${e}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

// One-time idempotent column add for the `recovered` flag — pattern
// matches ensureFoldersSchema. Cached at module level so we run the
// ALTER once per cold start, not per asset insert.
let recoveredColumnEnsured = false
async function ensureRecoveredColumn(sql: ReturnType<typeof getDb>) {
  if (recoveredColumnEnsured) return
  try {
    await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
    recoveredColumnEnsured = true
  } catch (err) {
    console.error('[r2-upload] failed to ensure recovered column:', err)
  }
}

export async function recordAsset(
  type: 'image' | 'video',
  model: string,
  prompt: string,
  r2Url: string,
  projectId: string,
  options: { recovered?: boolean } = {}
) {
  const sql = getDb()
  await ensureRecoveredColumn(sql)
  const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  const recovered = options.recovered === true

  await sql`
    INSERT INTO generation_history (id, type, model, prompt, r2_url, used_in_canvas, created_at, expires_at, project_id, recovered)
    VALUES (${id}, ${type}, ${model}, ${prompt}, ${r2Url}, false, CURRENT_TIMESTAMP, ${expiresAt}, ${projectId}, ${recovered})
  `

  return id
}

export async function markAssetUsedInCanvas(assetId: string) {
  const sql = getDb()
  await sql`UPDATE generation_history SET used_in_canvas = true WHERE id = ${assetId}`
}
