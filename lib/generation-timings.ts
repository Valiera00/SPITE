// How long generations take, recorded so SPITE can say how long the next one
// will. One small row per job (a few hundred bytes, in the database): what was
// asked for, when it was sent, when it started rendering and when it finished.
//
// The estimate is a weighted look at earlier runs of the same model. A run
// counts for more the more it resembles the job being estimated: same
// resolution and quality, similar clip length, a similar hour of the day, the
// same kind of day (working day or not), and how recent it is. So it follows
// each provider's busy hours and drifts with them, and gets steadier with
// every job. Until a model has a couple of comparable runs there is no
// estimate at all, rather than a guess.
//
// Nothing here may ever fail a generation: every write swallows its errors.

import { after } from 'next/server'
import { getDb, type Sql } from './db'

/**
 * Keeps a timing write alive until it finishes without making the request wait
 * for it. Pass a promise that has already started when the moment it records
 * matters (a finish must be stamped when it is seen, not after the response).
 */
export function later(work: Promise<void> | (() => Promise<void>)): void {
  const run = typeof work === 'function' ? work : () => work
  try {
    after(run)
  } catch {
    void run() // no request to attach to (a script, a test): just let it run
  }
}

let ready = false
async function ensure(sql: Sql) {
  if (ready) return
  await sql`CREATE TABLE IF NOT EXISTS generation_timings (
    request_id       text PRIMARY KEY,
    model_id         text NOT NULL,
    kind             text NOT NULL,
    provider         text NOT NULL DEFAULT 'fal',
    resolution       text,
    quality          text,
    clip_seconds     integer,
    sound            boolean,
    ref_count        integer NOT NULL DEFAULT 0,
    has_frame        boolean NOT NULL DEFAULT false,
    submitted_at     timestamptz NOT NULL DEFAULT now(),
    started_at       timestamptz,
    last_running_at  timestamptz,
    finished_at      timestamptz,
    outcome          text,
    total_seconds    real,
    queue_seconds    real,
    render_seconds   real,
    slack_seconds    real
  )`
  await sql`CREATE INDEX IF NOT EXISTS idx_generation_timings_model ON generation_timings (model_id, finished_at DESC)`
  ready = true
}

const short = (v: unknown): string | null => (typeof v === 'string' && v && v.length <= 24 ? v : null)

/** A job was accepted by a provider. */
export async function recordSubmitted(job: {
  requestId: string
  modelId: string
  kind: 'image' | 'video'
  provider: string
  resolution?: unknown
  quality?: unknown
  clipSeconds?: number
  sound?: boolean
  refCount?: number
  hasFrame?: boolean
}): Promise<void> {
  try {
    const sql = getDb()
    await ensure(sql)
    await sql`
      INSERT INTO generation_timings (request_id, model_id, kind, provider, resolution, quality, clip_seconds, sound, ref_count, has_frame)
      VALUES (${job.requestId}, ${job.modelId}, ${job.kind}, ${job.provider}, ${short(job.resolution)}, ${short(job.quality)},
              ${Number.isFinite(job.clipSeconds) ? Math.round(job.clipSeconds as number) : null},
              ${typeof job.sound === 'boolean' ? job.sound : null}, ${job.refCount || 0}, ${!!job.hasFrame})
      ON CONFLICT (request_id) DO NOTHING
    `
  } catch (err) {
    console.error('[timings] submit not recorded:', err instanceof Error ? err.message : err)
  }
}

/**
 * A status check saw the job still going. Notes when it was last seen
 * unfinished (so the finish time is known to within one check) and when it was
 * first seen rendering rather than queued. Writes at most every few seconds.
 */
export async function recordStillRunning(requestId: string, rendering: boolean): Promise<void> {
  try {
    const sql = getDb()
    await ensure(sql)
    await sql`
      UPDATE generation_timings
      SET last_running_at = now(),
          started_at = COALESCE(started_at, CASE WHEN ${rendering} THEN now() END)
      WHERE request_id = ${requestId} AND finished_at IS NULL
        AND (last_running_at IS NULL OR last_running_at < now() - interval '4 seconds' OR (${rendering} AND started_at IS NULL))
    `
  } catch (err) {
    console.error('[timings] progress not recorded:', err instanceof Error ? err.message : err)
  }
}

/**
 * A status check saw the job finished. The true finish lies between the last
 * check that saw it running and this one; the middle of that gap is recorded,
 * with the gap itself (`slack_seconds`), so runs whose finish was only noticed
 * long afterwards can be left out of estimates.
 */
export async function recordFinished(
  requestId: string,
  outcome: 'done' | 'failed' | 'cancelled',
  renderSeconds?: number,
): Promise<void> {
  try {
    const sql = getDb()
    await ensure(sql)
    await sql`
      UPDATE generation_timings t
      SET finished_at = now(),
          outcome = ${outcome},
          render_seconds = ${Number.isFinite(renderSeconds) ? renderSeconds : null},
          slack_seconds = EXTRACT(EPOCH FROM (now() - COALESCE(t.last_running_at, t.submitted_at))),
          total_seconds = EXTRACT(EPOCH FROM (now() - t.submitted_at))
                          - EXTRACT(EPOCH FROM (now() - COALESCE(t.last_running_at, t.submitted_at))) / 2,
          queue_seconds = CASE WHEN t.started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (t.started_at - t.submitted_at)) END
      WHERE t.request_id = ${requestId} AND t.finished_at IS NULL
    `
  } catch (err) {
    console.error('[timings] finish not recorded:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Estimating
// ---------------------------------------------------------------------------

export interface TimeEstimate {
  /** A usual run, in seconds. */
  typical: number
  /** A slow one: about five runs in six finish within this. */
  slow: number
  /** How many earlier runs it rests on. */
  basedOn: number
}

// Days most of the world is off, when the providers' load looks like a weekend.
const OFF_DATES = new Set(['01-01', '12-24', '12-25', '12-26', '12-31'])
function isOffDay(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6 || OFF_DATES.has(d.toISOString().slice(5, 10))
}

function weightedQuantile(points: { value: number; weight: number }[], q: number): number {
  const sorted = [...points].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((sum, p) => sum + p.weight, 0)
  let running = 0
  for (const p of sorted) {
    running += p.weight
    if (running >= total * q) return p.value
  }
  return sorted[sorted.length - 1].value
}

/**
 * How long a job like this usually takes, or null when there aren't yet enough
 * comparable runs to say.
 */
export async function estimateSeconds(job: {
  modelId: string
  provider?: string
  resolution?: unknown
  quality?: unknown
  clipSeconds?: number
  at?: Date
}): Promise<TimeEstimate | null> {
  try {
    const sql = getDb()
    await ensure(sql)
    // Only runs whose finish was noticed promptly: within 30s, or within a
    // fifth of the run's own length.
    const rows = (await sql`
      SELECT provider, resolution, quality, clip_seconds, submitted_at, total_seconds
      FROM generation_timings
      WHERE model_id = ${job.modelId} AND outcome = 'done' AND total_seconds > 0
        AND slack_seconds <= GREATEST(30, total_seconds * 0.2)
      ORDER BY finished_at DESC
      LIMIT 300
    `) as { provider: string; resolution: string | null; quality: string | null; clip_seconds: number | null; submitted_at: string; total_seconds: number }[]
    if (rows.length === 0) return null

    const at = job.at ?? new Date()
    const hour = at.getUTCHours() + at.getUTCMinutes() / 60
    const offDay = isOffDay(at)
    const wantRes = short(job.resolution)
    const wantQuality = short(job.quality)
    // Prefer runs on the same provider (fal and a maker's own API differ a lot);
    // fall back to any when that provider has none yet.
    const sameProvider = job.provider ? rows.filter((r) => r.provider === job.provider) : rows
    const pool = sameProvider.length > 0 ? sameProvider : rows

    const points = pool.map((r) => {
      const when = new Date(r.submitted_at)
      const ageDays = Math.max(0, (at.getTime() - when.getTime()) / 86_400_000)
      const h = when.getUTCHours() + when.getUTCMinutes() / 60
      const hourGap = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)) // 0..12, around the clock
      let weight = Math.pow(0.5, ageDays / 21)             // half as much every three weeks
      weight *= 0.4 + 0.6 * Math.exp(-((hourGap / 4) ** 2)) // same time of day counts most
      weight *= isOffDay(when) === offDay ? 1 : 0.6
      if (wantRes) weight *= r.resolution === wantRes ? 1 : 0.3
      if (wantQuality) weight *= r.quality === wantQuality ? 1 : 0.5
      if (job.clipSeconds && r.clip_seconds) weight *= Math.exp(-Math.abs(r.clip_seconds - job.clipSeconds) / 4)
      return { value: Number(r.total_seconds), weight }
    })
    const comparable = points.filter((p) => p.weight >= 0.15)
    // Two runs that really resemble this job, or it's too early to say.
    if (comparable.length < 2) return null
    return {
      typical: Math.round(weightedQuantile(comparable, 0.5)),
      slow: Math.round(weightedQuantile(comparable, 0.85)),
      basedOn: comparable.length,
    }
  } catch (err) {
    console.error('[timings] estimate failed:', err instanceof Error ? err.message : err)
    return null
  }
}
/** "45s", "3 min 20s", "12 min" */
export function spokenDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 20) return `${s}s`
  if (s < 90) return `${Math.round(s / 5) * 5}s`
  const rounded = Math.round(s / 10) * 10
  const m = Math.floor(rounded / 60)
  const rest = rounded % 60
  return m >= 10 || rest === 0 ? `${Math.round(s / 60)} min` : `${m} min ${rest}s`
}
