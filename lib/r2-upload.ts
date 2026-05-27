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
