// Direct BytePlus ModelArk access for Seedance 2.0 / 2.5.
//
// fal resells Seedance at roughly twice ByteDance's own price; same model,
// same content rules (fal passes BytePlus's real-face filter straight
// through). Used when Settings → Model providers says so and a key is set
// there or as BYTEPLUS_API_KEY (lib/model-routing.ts).
//
// Shape of the API (create, then poll):
//   POST {base}/contents/generations/tasks   → { id }
//   GET  {base}/contents/generations/tasks/{id}
//        → { status: queued|running|succeeded|failed|cancelled|expired,
//            content: { video_url }, error: { code, message } }
//   DELETE {base}/contents/generations/tasks/{id}   (cancels a queued task)
// Parameters go as top-level JSON fields. Output URLs expire after 24h, so
// results are re-hosted to R2 exactly like fal's.

import {
  ProviderError, modelOverride,
  type DirectProvider, type DirectTask, type DirectTaskInput,
} from './direct-provider'
import { getSetting } from './provider-secrets'

const LABEL = 'BytePlus'
const BASE_URL = (process.env.BYTEPLUS_API_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/+$/, '')

// SPITE model id → ModelArk model id. ModelArk ids carry a release date and
// BytePlus ships newer ones over time; override per model with e.g.
// BYTEPLUS_MODEL_SEEDANCE_2_5=dreamina-seedance-2-5-<date> without a deploy.
// Seedance 1.5 stays on fal: its price there already matches BytePlus.
const DEFAULT_MODELS: Record<string, string> = {
  'seedance-2.0': 'dreamina-seedance-2-0-260128',
  'seedance-2.5': 'dreamina-seedance-2-5-260628',
}

async function call(path: string, init: RequestInit): Promise<any> {
  const apiKey = await getSetting('BYTEPLUS_API_KEY')
  if (!apiKey) throw new ProviderError(`No ${LABEL} API key`, LABEL, 401)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
  } catch (err) {
    throw new ProviderError(`${LABEL} unreachable (${err instanceof Error ? err.message : 'network error'})`, LABEL, 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    const code = typeof e?.code === 'string' ? e.code : undefined
    const msg = (typeof e?.message === 'string' && e.message) || code || `${LABEL} returned ${res.status}`
    throw new ProviderError(msg, LABEL, res.status, code)
  }
  return data
}

/** Build the ModelArk request body from SPITE's settings. Pure, so it can be tested. */
export function buildByteplusBody(model: string, t: DirectTaskInput): Record<string, unknown> {
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

export const byteplusProvider: DirectProvider = {
  id: 'byteplus',
  label: LABEL,
  prefix: 'byteplus/',
  envVars: ['BYTEPLUS_API_KEY'],
  configured: async () => !!(await getSetting('BYTEPLUS_API_KEY')),
  missingConfig: () => 'no BytePlus API key yet (Settings → Model providers)',
  modelFor: (spiteId) => (DEFAULT_MODELS[spiteId] ? modelOverride('BYTEPLUS_MODEL_', spiteId) || DEFAULT_MODELS[spiteId] : null),
  pricingId: async () => 'byteplus',
  isValidEndpoint: (e): e is string => typeof e === 'string' && /^byteplus\/[a-z0-9][a-z0-9.-]{2,80}$/.test(e),
  isValidTaskId: (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{4,100}$/.test(id),

  async create(model, input) {
    const data = await call('/contents/generations/tasks', { method: 'POST', body: JSON.stringify(buildByteplusBody(model, input)) })
    const id = data?.id
    if (typeof id !== 'string' || !id) throw new ProviderError(`${LABEL} accepted the task but returned no id`, LABEL, 502)
    return id
  },

  async get(id): Promise<DirectTask> {
    const data = await call(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'GET' })
    const s = String(data?.status || '').toLowerCase()
    if (s === 'queued') return { status: 'IN_QUEUE' }
    if (s === 'running') return { status: 'IN_PROGRESS' }
    if (s === 'succeeded') {
      const url = data?.content?.video_url
      return typeof url === 'string' && url
        ? { status: 'COMPLETED', videoUrl: url }
        : { status: 'FAILED', error: `${LABEL} reported success but returned no video` }
    }
    if (s === 'failed' || s === 'cancelled' || s === 'canceled' || s === 'expired') {
      const e = data?.error
      return { status: 'FAILED', error: (typeof e?.message === 'string' && e.message) || e?.code || `Task ${s}` }
    }
    // Unknown status: keep polling rather than declare an outcome.
    return { status: 'IN_PROGRESS' }
  },

  async cancel(id) {
    await call(`/contents/generations/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}
