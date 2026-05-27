import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'

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
