// App event log: things that happened while nobody was looking.
//
// The nightly cleanup runs server-side with no browser open, so "Deleted 3
// assets from Project X" can't be a toast at the moment it happens. Instead the
// cleanup writes a row here, and the next page load toasts whatever is still
// unseen and lists everything in the notifications bell (components/
// version-badge.tsx). Version changes land here too, so "when was SPITE
// updated" is answered in the same place.

import { getDb } from './db'

export type EventKind = 'cleanup' | 'update' | 'info'

export interface AppEvent {
  id: number
  kind: EventKind
  title: string
  detail: Record<string, unknown> | null
  project_id: string | null
  created_at: string
  seen: boolean
}

let ready = false
async function ensure(sql: ReturnType<typeof getDb>) {
  if (ready) return
  await sql`CREATE TABLE IF NOT EXISTS app_events (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,
    title       text NOT NULL,
    detail      jsonb,
    project_id  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    seen        boolean NOT NULL DEFAULT false
  )`
  await sql`CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events (created_at DESC)`
  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  ready = true
}

/** Never throws — an event log must not be able to fail the job it describes. */
export async function logEvent(
  kind: EventKind,
  title: string,
  opts: { projectId?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const sql = getDb()
    await ensure(sql)
    await sql`INSERT INTO app_events (kind, title, detail, project_id)
              VALUES (${kind}, ${title}, ${opts.detail ? JSON.stringify(opts.detail) : null}::jsonb, ${opts.projectId ?? null})`
  } catch (err) {
    console.error('[events] failed to log event:', title, err)
  }
}

export async function listEvents(limit = 50): Promise<{ events: AppEvent[]; unseen: number }> {
  const sql = getDb()
  await ensure(sql)
  const events = (await sql`
    SELECT id, kind, title, detail, project_id, created_at, seen
    FROM app_events ORDER BY created_at DESC, id DESC LIMIT ${limit}
  `) as unknown as AppEvent[]
  const [{ unseen }] = (await sql`SELECT COUNT(*)::int AS unseen FROM app_events WHERE seen = false`) as { unseen: number }[]
  return { events, unseen }
}

export async function markAllSeen(): Promise<void> {
  const sql = getDb()
  await ensure(sql)
  await sql`UPDATE app_events SET seen = true WHERE seen = false`
}

/**
 * Record the running version. Logs an "Updated to vX" event when it differs
 * from the last version this install reported — but not on the very first
 * report, which is an install, not an update.
 */
export async function noteVersion(version: string): Promise<void> {
  const v = String(version || '').trim().slice(0, 40)
  if (!/^\d+\.\d+\.\d+/.test(v)) return
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'last_seen_version' LIMIT 1`
  const prev = rows[0]?.value as string | undefined
  if (prev === v) return
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('last_seen_version', ${v}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  if (prev) await logEvent('update', `SPITE updated to v${v}`, { detail: { from: prev, to: v } })
}
