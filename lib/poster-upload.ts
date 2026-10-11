// Store a video node's poster frame in R2 and hand back its proxy URL.
//
// Posters used to live inside the node's data as a base64 string, which made
// every canvas save carry the full image of every video on the board (see
// lib/canvas-payload.ts for the damage that did). Now the frame is a ~30 KB
// JPEG object in R2 and the node keeps a ~50-byte URL. Same presigned-PUT
// path the canvas uses for dropped files: the bytes never cross Vercel.
//
// Not recorded as a library asset — a poster is derived from the video, not
// something the user made. The project-delete route finds it anyway, since
// it sweeps every /api/r2-image/ URL referenced by a node.

export async function uploadPoster(blob: Blob, nodeId: string): Promise<string | null> {
  try {
    // .jpg so the r2-image thumbnailer treats it as a still image.
    const filename = `poster-${nodeId.replace(/[^\w-]+/g, '_')}.jpg`
    const presign = await fetch('/api/r2-presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType: 'image/jpeg' }),
    })
    if (!presign.ok) throw new Error(`presign ${presign.status}`)
    const { presignedUrl, proxyUrl } = (await presign.json()) as { presignedUrl: string; proxyUrl: string }
    const put = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
    if (!put.ok) throw new Error(`PUT ${put.status}`)
    return proxyUrl
  } catch (err) {
    console.warn('[poster] upload failed, keeping the frame in memory only:', err)
    return null
  }
}

/** A `data:` URL (the legacy stored form) back into bytes, for the one-time migration. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    return await (await fetch(dataUrl)).blob()
  } catch {
    return null
  }
}
