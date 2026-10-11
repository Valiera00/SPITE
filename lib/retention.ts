// Central data-retention policy. Two independent windows, enforced by the daily
// cleanup cron (/api/assets/cleanup):
//
//   Asset retention     — how long a generated result that was NEVER added to a
//                         canvas is kept before it's deleted. Anything on a canvas
//                         (used_in_canvas = true) is permanent and untouched.
//   Reference retention — how long reference *inputs* (images attached to a
//                         prompt, stored under the refs/ R2 prefix) are kept.
//
// BOTH default to 0 = NEVER DELETE. The effective value is resolved as:
//   1. a value saved in the DB (edited from Settings → Data Retention), else
//   2. the env var (ASSET_RETENTION_DAYS / REFERENCE_RETENTION_DAYS), else
//   3. the default (0).
// So self-hosters can still configure via env, and anyone can override it live
// from the Settings UI without a redeploy.

import { getDb } from './db'

const DEFAULT_ASSET_RETENTION_DAYS = 0     // 0 = never delete (fully opt-in)
const DEFAULT_REFERENCE_RETENTION_DAYS = 0 // 0 = never delete (fully opt-in)

const KEY_ASSET = 'asset_retention_days'
const KEY_REFERENCE = 'reference_retention_days'

function parseDays(raw: string | undefined | null, fallback: number): number {
  if (raw === undefined || raw === null || `${raw}`.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

let settingsReady = false
async function ensureSettings(sql: ReturnType<typeof getDb>) {
  if (settingsReady) return
  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  settingsReady = true
}

// Per-project override of the asset window. NULL = use the global value;
// 0 = never delete anything from this project. Self-healing ALTER so older
// installs pick the column up on first use.
let projectColumnReady = false
export async function ensureProjectRetentionColumn(sql: ReturnType<typeof getDb>) {
  if (projectColumnReady) return
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS asset_retention_days integer`
  projectColumnReady = true
}

/** The project's own asset window if set, else null (= inherits the global one). */
export async function getProjectAssetRetentionOverride(projectId: string): Promise<number | null> {
  try {
    const sql = getDb()
    await ensureProjectRetentionColumn(sql)
    const rows = await sql`SELECT asset_retention_days FROM projects WHERE id::text = ${projectId} LIMIT 1`
    const v = rows[0]?.asset_retention_days
    return v === null || v === undefined ? null : Math.max(0, Math.floor(Number(v)))
  } catch {
    return null
  }
}

/**
 * Effective asset window for a project: its override, else the global value.
 * Always 0 (never) for a Flow project — it has no canvas, so its results can
 * never be "placed on one" to earn protection; they are the project.
 */
export async function getProjectAssetRetentionDays(projectId: string): Promise<number> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT COALESCE(origin, 'canvas') AS origin FROM projects WHERE id::text = ${projectId} LIMIT 1`
    if (rows[0] && rows[0].origin !== 'canvas') return 0
  } catch {
    // No origin column on a very old install — treat as canvas.
  }
  const override = await getProjectAssetRetentionOverride(projectId)
  return override ?? (await getAssetRetentionDays())
}

/**
 * Set (or clear, with null) a project's asset window, then bring its existing
 * unprotected results in line — but only ever in the SAFE direction:
 *   0 (never)  → every timer in the project is cleared right away.
 *   N days     → timers are extended to at least now + N; none is shortened,
 *                and results with no timer keep having none.
 *   null       → timers are left exactly as they are.
 * Nothing here can make anything eligible for deletion sooner than it was.
 */
export async function setProjectAssetRetentionDays(projectId: string, days: number | null): Promise<void> {
  const sql = getDb()
  await ensureProjectRetentionColumn(sql)
  const value = days === null ? null : Math.max(0, Math.min(3650, Math.floor(Number(days) || 0)))
  await sql`UPDATE projects SET asset_retention_days = ${value} WHERE id::text = ${projectId}`
  if (value === 0) {
    await sql`UPDATE generation_history SET expires_at = NULL
              WHERE project_id = ${projectId} AND used_in_canvas = false AND expires_at IS NOT NULL`
  } else if (value !== null && value > 0) {
    const floor = new Date(Date.now() + value * 24 * 60 * 60 * 1000).toISOString()
    await sql`UPDATE generation_history SET expires_at = GREATEST(expires_at, ${floor}::timestamptz)
              WHERE project_id = ${projectId} AND used_in_canvas = false AND expires_at IS NOT NULL`
  }
}

// Read a saved override from the DB; null if unset or the table can't be read.
async function readSaved(key: string): Promise<number | null> {
  try {
    const sql = getDb()
    await ensureSettings(sql)
    const rows = await sql`SELECT value FROM app_settings WHERE key = ${key} LIMIT 1`
    if (rows.length === 0) return null
    const n = Number(rows[0].value)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  } catch {
    return null // DB hiccup → fall back to env/default, never throw
  }
}

/** Days unused (non-canvas) results are kept. 0 = never expire. */
export async function getAssetRetentionDays(): Promise<number> {
  const saved = await readSaved(KEY_ASSET)
  return saved ?? parseDays(process.env.ASSET_RETENTION_DAYS, DEFAULT_ASSET_RETENTION_DAYS)
}

/** Days reference inputs (refs/ prefix) are kept. 0 = never reclaim. */
export async function getReferenceRetentionDays(): Promise<number> {
  const saved = await readSaved(KEY_REFERENCE)
  return saved ?? parseDays(process.env.REFERENCE_RETENTION_DAYS, DEFAULT_REFERENCE_RETENTION_DAYS)
}

/** Persist both windows (from Settings → Data Retention). Clamped to >= 0 ints. */
export async function setRetentionDays(assetDays: number, referenceDays: number): Promise<void> {
  const sql = getDb()
  await ensureSettings(sql)
  const a = String(Math.max(0, Math.floor(Number(assetDays) || 0)))
  const r = String(Math.max(0, Math.floor(Number(referenceDays) || 0)))
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${KEY_ASSET}, ${a}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${KEY_REFERENCE}, ${r}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
}

/**
 * Expiry timestamp to stamp on a freshly-recorded, not-yet-on-canvas result.
 * Uses the project's own window when it has one. Returns null when the
 * effective window is 0 — i.e. it never expires.
 */
export async function assetExpiresAt(projectId?: string): Promise<Date | null> {
  const days = projectId ? await getProjectAssetRetentionDays(projectId) : await getAssetRetentionDays()
  if (days <= 0) return null
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}
