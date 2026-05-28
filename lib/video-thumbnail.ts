// Capture a still frame from a video URL and return it as a JPEG data URL.
// Used to populate the scene-shot bar's thumbnail for tagged video nodes —
// an <img> tag can't render an mp4, so we extract a freeze-frame instead.
//
// Returns null if the video can't be loaded, decoded, or drawn (e.g. CORS
// blocked, network failure, codec not supported). Caller should treat null
// as "no thumbnail available" and fall back to a placeholder.
export async function captureVideoThumbnail(
  url: string,
  timeSec = 0.1,
  maxWidth = 480,
): Promise<string | null> {
  if (typeof document === 'undefined') return null

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    let settled = false
    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { video.removeAttribute('src'); video.load() } catch {}
      resolve(result)
    }

    const timeout = setTimeout(() => finish(null), 15000)

    video.addEventListener('loadedmetadata', () => {
      const t = Math.min(timeSec, Math.max(0, (video.duration || timeSec) - 0.01))
      try { video.currentTime = t } catch { finish(null) }
    })

    video.addEventListener('seeked', () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return finish(null)
        const targetW = Math.min(w, maxWidth)
        const scale = targetW / w
        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish(null)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish(null)
      }
    })

    video.addEventListener('error', () => finish(null))
    video.src = url
  })
}
