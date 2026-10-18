// Direct BytePlus ModelArk access for Seedance 2.0 / 2.5.
//
// fal resells Seedance at roughly twice ByteDance's own price; same model,
// same content rules (fal passes BytePlus's real-face filter straight
// through). When BYTEPLUS_API_KEY is set, the submit route sends those two
// models here instead. Unset, nothing changes — fal handles everything.
//
// Shape of the API (create, then poll):
//   POST {base}/contents/generations/tasks   → { id }
//   GET  {base}/contents/generations/tasks/{id}
//        → { status: queued|running|succeeded|failed|cancelled|expired,
//            content: { video_url }, error: { code, message } }
//   DELETE {base}/contents/generations/tasks/{id}   (cancels a queued task)
// Parameters go as top-level JSON fields. Output URLs expire after 24h, so
// results are re-hosted to R2 exactly like fal's.
//
// Polling reuses the existing pipeline: the submit route hands the node a
// pseudo-endpoint "byteplus/<model id>" in place of a fal queue path, and the
// status / cancel / recover routes branch on that prefix.

export const BYTEPLUS_PREFIX = 'byteplus/'

const BASE_URL = (process.env.BYTEPLUS_API_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/+$/, '')

// SPITE model id → ModelArk model id. ModelArk ids carry a release date and
// BytePlus ships newer ones over time; override per model with e.g.
// BYTEPLUS_MODEL_SEEDANCE_2_5=dreamina-seedance-2-5-<date> without a deploy.
// Seedance 1.5 stays on fal: its price there already matches BytePlus.
const DEFAULT_MODELS: Record<string, string> = {
  'seedance-2.0': 'dreamina-seedance-2-0-260128',
  'seedance-2.5': 'dreamina-seedance-2-5-260628',
}

function envOverride(spiteId: string): string | undefined {
  const key = 'BYTEPLUS_MODEL_' + spiteId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const v = process.env[key]?.trim()
  return v && /^[a-z0-9][a-z0-9.-]{2,80}$/.test(v) ? v : undefined
}

/** The ModelArk model to use for a SPITE model, or null when it should go to fal. */
export function byteplusModelFor(spiteId: string): string | null {
  if (!process.env.BYTEPLUS_API_KEY) return null
  const base = DEFAULT_MODELS[spiteId]
  if (!base) return null
  return envOverride(spiteId) || base
}

export function isByteplusEndpoint(endpoint: unknown): endpoint is string {
  return typeof endpoint === 'string' && endpoint.startsWith(BYTEPLUS_PREFIX)
}

/** Strict: a pseudo-endpoint must be exactly "byteplus/<model id>". */
export function isValidByteplusEndpoint(endpoint: unknown): endpoint is string {
  return typeof endpoint === 'string' && /^byteplus\/[a-z0-9][a-z0-9.-]{2,80}$/.test(endpoint)
}

/** Task ids are opaque; allow only characters that are safe in a URL path. */
export function isValidByteplusTaskId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,100}$/.test(id)
}

export class ByteplusError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ByteplusError'
  }
  /**
   * Failures that mean "this route is unavailable", not "this request is bad":
   * unreachable, server error, bad/expired key, model not activated on the
   * account. The submit route falls back to fal on these. A 400 (invalid
   * parameter, a face filtered, …) would fail identically on fal, so it is
   * surfaced instead.
   */
  get routeUnavailable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 401 || this.status === 403 || this.status === 404
  }
}

async function call(path: string, init: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.BYTEPLUS_API_KEY}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
  } catch (err) {
    throw new ByteplusError(`BytePlus unreachable (${err instanceof Error ? err.message : 'network error'})`, 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    const code = typeof e?.code === 'string' ? e.code : undefined
    const msg = (typeof e?.message === 'string' && e.message) || code || `BytePlus returned ${res.status}`
    throw new ByteplusError(msg, res.status, code)
  }
  return data
}

export interface ByteplusTaskInput {
  prompt: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceAudioUrls?: string[]
  aspectRatio?: string
  duration?: string
  resolution?: string
  generateAudio?: boolean
}

/** Build the ModelArk request body from SPITE's settings. Pure, so it can be tested. */
export function buildByteplusBody(model: string, t: ByteplusTaskInput): Record<string, unknown> {
  const content: Record<string, unknown>[] = [{ type: 'text', text: t.prompt }]
  // First/last frame and reference images are separate modes on Seedance 2.x;
  // the video node already refuses to submit both at once.
  if (t.firstFrameUrl) content.push({ type: 'image_url', image_url: { url: t.firstFrameUrl }, role: 'first_frame' })
  if (t.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: t.lastFrameUrl }, role: 'last_frame' })
  for (const url of t.referenceImageUrls || []) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  for (const url of t.referenceAudioUrls || []) content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })

  const body: Record<string, unknown> = { model, content, watermark: false }
  if (t.resolution) body.resolution = t.resolution
  // SPITE says "auto"; ModelArk says "adaptive".
  if (t.aspectRatio) body.ratio = t.aspectRatio === 'auto' ? 'adaptive' : t.aspectRatio
  if (t.duration) body.duration = t.duration === 'auto' ? -1 : parseInt(t.duration, 10)
  // Always explicit: ModelArk's default is true, like fal's.
  body.generate_audio = !!t.generateAudio
  return body
}

export async function createByteplusTask(body: Record<string, unknown>): Promise<string> {
  const data = await call('/contents/generations/tasks', { method: 'POST', body: JSON.stringify(body) })
  const id = data?.id
  if (typeof id !== 'string' || !id) throw new ByteplusError('BytePlus accepted the task but returned no id', 502)
  return id
}

export interface ByteplusTask {
  /** Mapped onto fal's vocabulary so the rest of the pipeline is shared. */
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  videoUrl?: string
  error?: string
}

export async function getByteplusTask(id: string): Promise<ByteplusTask> {
  const data = await call(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET' })
  const s = String(data?.status || '').toLowerCase()
  if (s === 'queued') return { status: 'IN_QUEUE' }
  if (s === 'running') return { status: 'IN_PROGRESS' }
  if (s === 'succeeded') {
    const url = data?.content?.video_url
    return typeof url === 'string' && url
      ? { status: 'COMPLETED', videoUrl: url }
      : { status: 'FAILED', error: 'BytePlus reported success but returned no video' }
  }
  if (s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'expired') {
    const e = data?.error
    return { status: 'FAILED', error: (typeof e?.message === 'string' && e.message) || e?.code || `Task ${s}` }
  }
  // Unknown status: keep polling rather than declare an outcome.
  return { status: 'IN_PROGRESS' }
}

export async function cancelByteplusTask(id: string): Promise<void> {
  await call(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
