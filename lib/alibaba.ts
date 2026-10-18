// Direct Alibaba Cloud Model Studio (DashScope) access for Wan 3.0.
//
// Wan 3.0 costs the same on fal as in Alibaba's Singapore region, but about
// 17% less in its other international regions (Frankfurt, Virginia, Tokyo):
// $0.041 / $0.083 / $0.165 per second at 480p / 720p / 1080p against
// $0.05 / $0.10 / $0.20. Used when Settings → Model providers says so and a
// key is set there or as DASHSCOPE_API_KEY (lib/model-routing.ts).
//
// API (from the Wan3.0 Video Generation API Reference):
//   POST {base}/api/v1/services/aigc/video-generation/video-synthesis
//        header X-DashScope-Async: enable
//        { model, input: { prompt, media: [{ type, url }] },
//          parameters: { resolution, ratio, duration, audio, watermark } }
//        → { output: { task_id, task_status } }
//   GET  {base}/api/v1/tasks/{task_id}
//        → { output: { task_status: PENDING|RUNNING|SUCCEEDED|FAILED|
//                       CANCELED|UNKNOWN, video_url, code, message } }
//   POST {base}/api/v1/tasks/{task_id}/cancel
// The video URL and the task id both expire after 24 hours.
//
// Endpoint. Model Studio workspaces have their own host:
//   https://{DASHSCOPE_WORKSPACE_ID}.{DASHSCOPE_REGION}.maas.aliyuncs.com
// with DASHSCOPE_REGION one of us-east-1 (Virginia), eu-central-1
// (Frankfurt), ap-northeast-1 (Tokyo), ap-southeast-1 (Singapore). Both can be
// set in Settings or as environment variables. Without a workspace id the
// shared international endpoint (Singapore) is used. The DASHSCOPE_BASE_URL
// environment variable overrides all of that.

import {
  ProviderError, modelOverride,
  type DirectProvider, type DirectTask, type DirectTaskInput, type PricingProvider,
} from './direct-provider'
import { getSetting } from './provider-secrets'

const LABEL = 'Alibaba Model Studio'
const SINGAPORE = 'ap-southeast-1'

async function endpoint(): Promise<{ base: string; region: string }> {
  const override = process.env.DASHSCOPE_BASE_URL?.trim()
  if (override) {
    const host = (() => { try { return new URL(override).hostname } catch { return '' } })()
    // A host we can't place is priced as Singapore, the dearer rate, so the
    // spend gate never under-estimates.
    const region = host.match(/\.([a-z]{2}-[a-z]+-\d)\.maas\.aliyuncs\.com$/)?.[1] || SINGAPORE
    return { base: override.replace(/\/+$/, ''), region }
  }
  const ws = await getSetting('DASHSCOPE_WORKSPACE_ID')
  const region = (await getSetting('DASHSCOPE_REGION')) || SINGAPORE
  // Both go into a hostname: accept only characters that can't redirect it.
  if (ws && /^[A-Za-z0-9-]{3,64}$/.test(ws) && /^[a-z]{2}-[a-z]+-\d$/.test(region)) {
    return { base: `https://${ws}.${region}.maas.aliyuncs.com`, region }
  }
  return { base: 'https://dashscope-intl.aliyuncs.com', region: SINGAPORE }
}

const DEFAULT_MODELS: Record<string, string> = {
  'wan-3.0': 'wan3.0-video',
}

async function call(path: string, init: RequestInit & { async?: boolean }): Promise<any> {
  const apiKey = await getSetting('DASHSCOPE_API_KEY')
  if (!apiKey) throw new ProviderError(`No ${LABEL} API key`, LABEL, 401)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (init.async) headers['X-DashScope-Async'] = 'enable'
  let res: Response
  try {
    res = await fetch(`${(await endpoint()).base}${path}`, { method: init.method, body: init.body, headers, cache: 'no-store' })
  } catch (err) {
    throw new ProviderError(`${LABEL} unreachable (${err instanceof Error ? err.message : 'network error'})`, LABEL, 0)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const code = typeof data?.code === 'string' ? data.code : undefined
    const msg = (typeof data?.message === 'string' && data.message) || code || `${LABEL} returned ${res.status}`
    throw new ProviderError(msg, LABEL, res.status, code)
  }
  return data
}

/** Build the Model Studio request body from SPITE's settings. Pure, so it can be tested. */
export function buildAlibabaBody(model: string, t: DirectTaskInput): Record<string, unknown> {
  const media: { type: string; url: string }[] = []
  if (t.firstFrameUrl) media.push({ type: 'first_frame', url: t.firstFrameUrl })
  if (t.lastFrameUrl) media.push({ type: 'last_frame', url: t.lastFrameUrl })
  for (const url of t.referenceImageUrls || []) media.push({ type: 'reference_image', url })
  for (const url of t.referenceAudioUrls || []) media.push({ type: 'reference_audio', url })

  const input: Record<string, unknown> = { prompt: t.prompt }
  if (media.length) input.media = media

  const parameters: Record<string, unknown> = { watermark: false, audio: !!t.generateAudio }
  // Model Studio writes resolutions in capitals: 1080P.
  if (t.resolution) parameters.resolution = t.resolution.toUpperCase()
  if (t.aspectRatio) parameters.ratio = t.aspectRatio === 'auto' ? 'adaptive' : t.aspectRatio
  // Smart duration is the integer -1, not a string.
  if (t.duration) parameters.duration = t.duration === 'auto' ? -1 : parseInt(t.duration, 10)
  return { model, input, parameters }
}

export const alibabaProvider: DirectProvider = {
  id: 'alibaba',
  label: LABEL,
  // Not 'alibaba/': that is fal's own namespace for Wan (alibaba/wan-3.0/…),
  // and a fal job must never be mistaken for a direct one.
  prefix: 'dashscope/',
  envVars: ['DASHSCOPE_API_KEY', 'DASHSCOPE_WORKSPACE_ID', 'DASHSCOPE_REGION'],
  configured: async () => !!(await getSetting('DASHSCOPE_API_KEY')),
  missingConfig: () => 'no Alibaba API key yet (Settings → Model providers)',
  modelFor: (spiteId) => (DEFAULT_MODELS[spiteId] ? modelOverride('DASHSCOPE_MODEL_', spiteId) || DEFAULT_MODELS[spiteId] : null),
  // Singapore is priced like fal; the other international regions are cheaper.
  pricingId: async (): Promise<PricingProvider> => ((await endpoint()).region === SINGAPORE ? 'alibaba-sg' : 'alibaba'),
  isValidEndpoint: (e): e is string => typeof e === 'string' && /^dashscope\/[a-z0-9][a-z0-9.-]{2,80}$/.test(e),
  isValidTaskId: (id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(id),

  async create(model, input) {
    const data = await call('/api/v1/services/aigc/video-generation/video-synthesis', {
      method: 'POST', async: true, body: JSON.stringify(buildAlibabaBody(model, input)),
    })
    const id = data?.output?.task_id
    if (typeof id !== 'string' || !id) throw new ProviderError(`${LABEL} accepted the task but returned no id`, LABEL, 502)
    return id
  },

  async get(id): Promise<DirectTask> {
    const data = await call(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: 'GET' })
    const out = data?.output || {}
    const s = String(out.task_status || '').toUpperCase()
    if (s === 'PENDING') return { status: 'IN_QUEUE' }
    if (s === 'RUNNING') return { status: 'IN_PROGRESS' }
    if (s === 'SUCCEEDED') {
      return typeof out.video_url === 'string' && out.video_url
        ? { status: 'COMPLETED', videoUrl: out.video_url }
        : { status: 'FAILED', error: `${LABEL} reported success but returned no video` }
    }
    if (s === 'FAILED' || s === 'CANCELED' || s === 'CANCELLED') {
      return { status: 'FAILED', error: (typeof out.message === 'string' && out.message) || out.code || `Task ${s.toLowerCase()}` }
    }
    // UNKNOWN means the task id has expired (24h) or never existed.
    if (s === 'UNKNOWN') return { status: 'FAILED', error: `${LABEL} no longer has this task (task ids expire after 24 hours)` }
    return { status: 'IN_PROGRESS' }
  },

  async cancel(id) {
    await call(`/api/v1/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  },
}
