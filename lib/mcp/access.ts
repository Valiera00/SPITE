// Access to SPITE's MCP endpoint (/api/mcp), which lets the owner's own Claude
// work in SPITE. Off until a token is created in Settings → Claude connection.
//
// One token at a time. Only its SHA-256 hash is stored, so the database never
// holds anything that could be replayed; the plain token is shown once, at
// creation. Turning the connection off deletes the row.

import { createHash, randomBytes } from 'node:crypto'
import { getDb, type Sql } from '../db'

const TOKEN_PREFIX = 'spite_'
const LIMIT_KEY = 'mcp_hourly_limit_usd'
// What Claude may spend per hour unless Settings says otherwise. Deliberately
// small: it is a ceiling for an assistant working from a brief, on top of the
// app-wide spend gate, and can only be raised by the owner in Settings.
export const DEFAULT_MCP_HOURLY_LIMIT_USD = 5

let ready = false
async function ensure(sql: Sql) {
  if (ready) return
  await sql`CREATE TABLE IF NOT EXISTS mcp_tokens (
    token_hash    text PRIMARY KEY,
    hint          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz
  )`
  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  ready = true
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface McpStatus {
  enabled: boolean
  /** Last four characters of the token. */
  hint?: string
  createdAt?: string
  lastUsedAt?: string | null
  hourlyLimitUsd: number
}

export async function getMcpHourlyLimitUsd(): Promise<number> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`SELECT value FROM app_settings WHERE key = ${LIMIT_KEY} LIMIT 1`
  const n = rows.length ? Number(rows[0].value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MCP_HOURLY_LIMIT_USD
}

export async function setMcpHourlyLimitUsd(usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) throw new Error('The limit must be a number from 0 up.')
  const sql = getDb()
  await ensure(sql)
  const value = String(Math.round(usd * 100) / 100)
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${LIMIT_KEY}, ${value}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
}

export async function getMcpStatus(): Promise<McpStatus> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`SELECT hint, created_at, last_used_at FROM mcp_tokens ORDER BY created_at DESC LIMIT 1`
  const hourlyLimitUsd = await getMcpHourlyLimitUsd()
  if (rows.length === 0) return { enabled: false, hourlyLimitUsd }
  const r = rows[0]
  return {
    enabled: true,
    hint: String(r.hint),
    createdAt: new Date(r.created_at as string).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
    hourlyLimitUsd,
  }
}

/** Turn the connection on (or replace the token). Returns the plain token: the only time it exists outside the caller. */
export async function createMcpToken(): Promise<string> {
  const sql = getDb()
  await ensure(sql)
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex')
  await sql.transaction([
    sql`DELETE FROM mcp_tokens`,
    sql`INSERT INTO mcp_tokens (token_hash, hint) VALUES (${hashToken(token)}, ${token.slice(-4)})`,
  ])
  return token
}

/** Turn the connection off. Every request with the old token is refused from here on. */
export async function revokeMcpToken(): Promise<void> {
  const sql = getDb()
  await ensure(sql)
  await sql`DELETE FROM mcp_tokens`
}

// A token that just verified, kept briefly so a burst of tool calls is one
// database lookup, not one per call. Short enough that turning the connection
// off takes effect almost at once.
let verified: { hash: string; until: number } | null = null
const VERIFY_TTL_MS = 15_000

/** Whether an `Authorization` header carries the current token. */
export async function verifyMcpAuthHeader(header: string | null): Promise<boolean> {
  const m = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null
  const token = m?.[1]
  // Shape check first: nothing but a well-formed token reaches the database.
  if (!token || !/^spite_[a-f0-9]{64}$/.test(token)) return false
  const hash = hashToken(token)
  if (verified && verified.hash === hash && verified.until > Date.now()) return true
  try {
    const sql = getDb()
    await ensure(sql)
    // Lookup by hash: the comparison happens on a digest, so its timing says
    // nothing about the token itself.
    const rows = await sql`UPDATE mcp_tokens SET last_used_at = now() WHERE token_hash = ${hash} RETURNING token_hash`
    if (rows.length === 0) {
      if (verified?.hash === hash) verified = null
      return false
    }
    verified = { hash, until: Date.now() + VERIFY_TTL_MS }
    return true
  } catch (err) {
    console.error('[mcp] token check failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/** Forget the cached verification (called when the token is replaced or revoked). */
export function forgetVerifiedMcpToken(): void {
  verified = null
}
