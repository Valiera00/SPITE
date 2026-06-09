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

import { neon } from '@neondatabase/serverless'

type Sql = ReturnType<typeof neon>

function getDb(): Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set')
  }
  return neon(process.env.DATABASE_URL)
}

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
  if (!requestId) {
    throw new Error('create-voice did not return a request_id')
  }

  // Poll every 1 s for up to ~90 s. Plenty for create-voice typical
  // latency; fail-fast if the model is stuck so the user sees an
  // error in the jobs panel instead of a spinner forever.
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/kling-video/create-voice/requests/${requestId}/status`,
      { headers: { Authorization: `Key ${falKey}` } },
    )
    if (!statusRes.ok) continue
    const status = (await statusRes.json()) as { status?: string }
    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/kling-video/create-voice/requests/${requestId}`,
        { headers: { Authorization: `Key ${falKey}` } },
      )
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
      throw new Error(`create-voice failed on fal: ${JSON.stringify(status)}`)
    }
  }
  throw new Error('create-voice polling timed out after 90 s')
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
