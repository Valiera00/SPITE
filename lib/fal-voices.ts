// Kling 2.6 voice cloning: turn an audio file into a fal voice_id and
// cache it forever. Each unique audio URL costs one create-voice call;
// subsequent generations reuse the cached voice_id with zero cost and
// zero latency.
//
// Flow when a user wires an audio reference into a Kling 2.6 node:
//   1. submit route notices settings.audioUrl is set
//   2. calls getOrCreateVoiceId(proxyUrl, presignedFalUrl, falKey)
//   3. we look up proxyUrl in voice_id_cache — found = return immediately
//   4. not found → POST queue.fal.run/.../create-voice → poll status →
//      get voice_id from result → INSERT cache row → return
//   5. submit appends the voice_id to the Kling 2.6 voice_ids array
//
// The cache key is the SPITE proxy URL (/api/r2-image/<key>) because
// that's stable per asset. The fetchable URL we hand to fal is a
// short-lived R2 presigned URL (regenerated each create-voice call,
// which only happens once per unique audio file anyway).

import { getDb, type Sql } from './db'

let cacheSchemaEnsured = false
async function ensureCacheSchema(sql: Sql) {
  if (cacheSchemaEnsured) return
  await sql`
    CREATE TABLE IF NOT EXISTS voice_id_cache (
      audio_url   text PRIMARY KEY,
      voice_id    text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `
  cacheSchemaEnsured = true
}

async function lookupCachedVoiceId(audioUrl: string): Promise<string | null> {
  try {
    const sql = getDb()
    await ensureCacheSchema(sql)
    const rows = (await sql`
      SELECT voice_id FROM voice_id_cache WHERE audio_url = ${audioUrl} LIMIT 1
    `) as { voice_id: string }[]
    return rows[0]?.voice_id ?? null
  } catch (err) {
    console.error('[fal-voices] cache lookup failed:', err)
    return null
  }
}

async function saveVoiceId(audioUrl: string, voiceId: string) {
  try {
    const sql = getDb()
    await ensureCacheSchema(sql)
    await sql`
      INSERT INTO voice_id_cache (audio_url, voice_id)
      VALUES (${audioUrl}, ${voiceId})
      ON CONFLICT (audio_url) DO UPDATE SET voice_id = EXCLUDED.voice_id
    `
  } catch (err) {
    console.error('[fal-voices] cache save failed:', err)
  }
}

// Call fal's queue API to create a voice from an audio URL. fal docs
// say create-voice is queued + async, so we submit → poll status →
// fetch result. Total wall clock is usually 10–30 sec; the cache means
// we only pay this once per unique audio asset.
async function createFalVoice(
  audioFetchableUrl: string,
  falKey: string,
): Promise<string> {
  const submitRes = await fetch(
    'https://queue.fal.run/fal-ai/kling-video/create-voice',
    {
      method: 'POST',
      headers: {
        Authorization: `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voice_url: audioFetchableUrl }),
    },
  )
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '')
    throw new Error(`create-voice submit failed: ${submitRes.status} ${text}`)
  }
  const submitData = await submitRes.json()
  const requestId = submitData.request_id as string | undefined
  // Use the status/response URLs fal returns rather than reconstructing them —
  // a reconstructed path that's even slightly off would 404 on every poll and
  // silently burn the whole timeout. Fall back to the reconstructed form only
  // if fal omits them.
  const statusUrl = (submitData.status_url as string | undefined)
    || `https://queue.fal.run/fal-ai/kling-video/create-voice/requests/${requestId}/status`
  const responseUrl = (submitData.response_url as string | undefined)
    || `https://queue.fal.run/fal-ai/kling-video/create-voice/requests/${requestId}`
  if (!requestId) {
    throw new Error('create-voice did not return a request_id')
  }

  // Poll up to ~3 min (create-voice can queue behind other jobs). Fail LOUDLY
  // on a 4xx status response instead of silently looping, and report the last
  // seen state on timeout so a genuine "still queued" is distinguishable from
  // a broken poll.
  let lastStatus = 'unknown'
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1500))
    const statusRes = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey}` } })
    if (!statusRes.ok) {
      if (statusRes.status >= 400 && statusRes.status < 500) {
        const t = await statusRes.text().catch(() => '')
        throw new Error(`create-voice status ${statusRes.status}: ${t.slice(0, 200)}`)
      }
      continue // transient 5xx — keep polling
    }
    const status = (await statusRes.json()) as { status?: string }
    lastStatus = status.status || lastStatus
    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey}` } })
      if (!resultRes.ok) {
        throw new Error(`create-voice result fetch failed: ${resultRes.status}`)
      }
      const result = (await resultRes.json()) as { voice_id?: string }
      if (!result.voice_id) {
        throw new Error('create-voice returned no voice_id')
      }
      return result.voice_id
    }
    if (status.status === 'FAILED') {
      throw new Error(`create-voice failed on fal: ${JSON.stringify(status).slice(0, 200)}`)
    }
  }
  throw new Error(`create-voice polling timed out (last status: ${lastStatus})`)
}

// Public entry point. Returns the voice_id for the given audio URL,
// hitting the cache when possible.
export async function getOrCreateVoiceId(
  audioUrlCacheKey: string,
  audioFetchableUrl: string,
  falKey: string,
): Promise<string> {
  const cached = await lookupCachedVoiceId(audioUrlCacheKey)
  if (cached) return cached
  const voiceId = await createFalVoice(audioFetchableUrl, falKey)
  await saveVoiceId(audioUrlCacheKey, voiceId)
  return voiceId
}
