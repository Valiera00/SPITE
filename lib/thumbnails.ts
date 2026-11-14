import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { getR2Client, isRasterImage, thumbKeyFor, THUMB_WIDTH } from './r2-upload'

// Return the stored thumbnail for `key`, generating and storing it on first
// request. Returns null on any failure (missing original, undecodable image,
// R2 error) so the caller can fall back to serving the original — a
// thumbnail problem must never turn into a broken image.
export async function getOrCreateThumbnail(key: string): Promise<Buffer | null> {
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
    // Only real PNG/JPEG/WebP reaches sharp, whatever the file is named.
    // Anything else falls back to serving the original.
    if (!isRasterImage(bytes)) return null
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
    console.error('[thumbnails] failed for', key, err)
    return null
  }
}

export interface Preview {
  data: Buffer
  /** Pixel size of the stored original. */
  width: number
  height: number
}

/**
 * A one-off JPEG rendition of a stored image, longest side at most `size`,
 * with the original's pixel size. Not stored: for views that are requested
 * rarely and at varying sizes. Null when the object is missing or isn't a
 * still image.
 */
export async function renderPreview(key: string, size: number): Promise<Preview | null> {
  try {
    const original = await getR2Client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    )
    const bytes = await original.Body?.transformToByteArray()
    if (!bytes?.length || !isRasterImage(bytes)) return null
    const input = Buffer.from(bytes)
    const meta = await sharp(input).metadata()
    if (!meta.width || !meta.height) return null
    // EXIF orientations 5-8 are stored on their side: report the upright size.
    const sideways = (meta.orientation ?? 1) >= 5
    const data = await sharp(input)
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
    return { data, width: sideways ? meta.height : meta.width, height: sideways ? meta.width : meta.height }
  } catch (err) {
    console.error('[thumbnails] preview failed for', key, err)
    return null
  }
}

/** Pixel size of an image buffer (e.g. a stored thumbnail, which keeps the original's shape). */
export async function imageSize(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(buffer).metadata()
    return width && height ? { width, height } : null
  } catch {
    return null
  }
}
