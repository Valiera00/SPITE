// Client-side image downscale + re-encode helpers. Used by the Compress node
// to shrink an oversized still (e.g. a 4K frame) under a provider's byte limit
// — Kling rejects reference images larger than 10 MB. All work happens in the
// browser on a <canvas>; nothing is uploaded until the user applies a result.

// Kling's hard limit for a reference/first-frame image, in bytes (10 MiB).
export const KLING_MAX_BYTES = 10_485_760

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Draw a source bitmap scaled by `scale` (0..1) and re-encode as JPEG at the
// given quality (0..1). Returns the encoded blob plus its pixel dimensions.
export async function encodeScaled(
  bitmap: ImageBitmap,
  scale: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new Error('Image encoding failed')
  return { blob, width, height }
}

// Find the largest scale/quality whose JPEG fits under `maxBytes`. Tries the
// quality ladder at each scale before shrinking dimensions, so it preserves as
// much resolution as possible. Returns the first candidate under the limit, or
// — if even the smallest can't fit — the smallest it produced (caller should
// surface that it's still over).
export async function autoFitUnderBytes(
  bitmap: ImageBitmap,
  maxBytes: number,
): Promise<{ blob: Blob; width: number; height: number; scale: number; quality: number }> {
  const scales = [1, 0.85, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25]
  const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]
  let smallest: { blob: Blob; width: number; height: number; scale: number; quality: number } | null = null
  for (const scale of scales) {
    for (const quality of qualities) {
      const { blob, width, height } = await encodeScaled(bitmap, scale, quality)
      if (blob.size <= maxBytes) return { blob, width, height, scale, quality }
      smallest = { blob, width, height, scale, quality }
    }
  }
  // Nothing fit (extreme source) — hand back the smallest we could make.
  return smallest!
}
