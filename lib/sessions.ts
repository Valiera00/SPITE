// Server-side session + login rate-limit primitives, backed by Postgres
// so revocation and brute-force counters survive cold starts.
//
// Edge-compatible: uses Web Crypto (globalThis.crypto.getRandomValues +
// TextEncoder + manual constant-time compare) instead of Node's
// `crypto` module so the same module can be imported from both edge
// middleware and the Node-runtime API routes.

import { getDb, type Sql } from './db'

// Cached on the warm worker so we don't CREATE TABLE on every request.
let schemaEnsured = false
async function ensureSchema(sql: Sql) {
  if (schemaEnsured) return
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token       text PRIMARY KEY,
      created_at  timestamptz NOT NULL DEFAULT now(),
      expires_at  timestamptz NOT NULL DEFAULT (now() + interval '30 days')
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at)`
  await sql`
    CREATE TABLE IF NOT EXISTS auth_attempts (
      ip            text NOT NULL,
      attempted_at  timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_time ON auth_attempts (ip, attempted_at)`
  schemaEnsured = true
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'spite_session'
export const SESSION_DURATION_DAYS = 30
export const SESSION_TOKEN_HEX_LENGTH = 64 // 32 bytes -> 64 hex chars

const RATE_LIMIT_MAX_ATTEMPTS = 5
const RATE_LIMIT_WINDOW_SECONDS = 60

// ---------------------------------------------------------------------------
// Crypto helpers — Web Crypto so this module works in edge runtime.
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time string compare. Always touches every byte of the
// longer input so timing doesn't differ for equal-length-different vs
// different-length inputs.
export function safeStringEquals(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const bufA = enc.encode(a)
  const bufB = enc.encode(b)
  const len = Math.max(bufA.length, bufB.length)
  let result = bufA.length ^ bufB.length
  for (let i = 0; i < len; i++) {
    result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0)
  }
  return result === 0
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(): Promise<string> {
  const sql = getDb()
  await ensureSchema(sql)
  const token = randomHex(32)
  await sql`
    INSERT INTO sessions (token, expires_at)
    VALUES (${token}, now() + (${SESSION_DURATION_DAYS} || ' days')::interval)
  `
  return token
}

// True if the token exists and hasn't expired. Fail-closed on any
// error (DB unreachable, schema missing, etc.) — transient infra
// trouble must not accidentally open the gate.
export async function isSessionValid(token: string | undefined | null): Promise<boolean> {
  if (!token || typeof token !== 'string' || token.length !== SESSION_TOKEN_HEX_LENGTH) {
    return false
  }
  // Sanity: only hex chars. Keeps obviously-malformed tokens out of the
  // SQL parameter (already safe via the driver, but no reason to query).
  if (!/^[a-f0-9]+$/i.test(token)) return false
  try {
    const sql = getDb()
    await ensureSchema(sql)
    const rows = (await sql`
      SELECT 1 FROM sessions WHERE token = ${token} AND expires_at > now() LIMIT 1
    `) as unknown[]
    return rows.length > 0
  } catch (err) {
    console.error('[sessions] isSessionValid failed:', err)
    return false
  }
}

export async function revokeSession(token: string | undefined | null): Promise<void> {
  if (!token) return
  try {
    const sql = getDb()
    await ensureSchema(sql)
    await sql`DELETE FROM sessions WHERE token = ${token}`
  } catch (err) {
    console.error('[sessions] revokeSession failed:', err)
  }
}

// Called by the cleanup cron — keeps both tables bounded.
export async function purgeExpiredSessions(): Promise<{ sessions: number; attempts: number }> {
  const sql = getDb()
  await ensureSchema(sql)
  const sessionsDeleted = (await sql`
    DELETE FROM sessions WHERE expires_at < now() RETURNING token
  `) as unknown[]
  const attemptsDeleted = (await sql`
    DELETE FROM auth_attempts WHERE attempted_at < now() - interval '1 hour' RETURNING ip
  `) as unknown[]
  return { sessions: sessionsDeleted.length, attempts: attemptsDeleted.length }
}

// ---------------------------------------------------------------------------
// Login rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export async function checkLoginRateLimit(ip: string): Promise<RateLimitResult> {
  const sql = getDb()
  await ensureSchema(sql)
  const rows = (await sql`
    SELECT count(*)::int AS n FROM auth_attempts
    WHERE ip = ${ip} AND attempted_at > now() - (${RATE_LIMIT_WINDOW_SECONDS} || ' seconds')::interval
  `) as { n: number }[]
  const attempts = rows[0]?.n ?? 0
  if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS }
  }
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_ATTEMPTS - attempts,
    retryAfterSeconds: 0,
  }
}

export async function recordFailedLogin(ip: string): Promise<void> {
  try {
    const sql = getDb()
    await ensureSchema(sql)
    await sql`INSERT INTO auth_attempts (ip) VALUES (${ip})`
  } catch (err) {
    console.error('[sessions] recordFailedLogin failed:', err)
  }
}

export async function clearLoginAttempts(ip: string): Promise<void> {
  try {
    const sql = getDb()
    await ensureSchema(sql)
    await sql`DELETE FROM auth_attempts WHERE ip = ${ip}`
  } catch (err) {
    console.error('[sessions] clearLoginAttempts failed:', err)
  }
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------

// Trusted client IP. On Vercel, x-real-ip is set from the actual TCP
// connection and cannot be spoofed by the client; x-forwarded-for's
// leftmost entry CAN be spoofed (an attacker can rotate it to evade
// the per-IP login rate limit). So we prefer x-real-ip and use xff
// only as a fall-through for non-Vercel hosts that don't set
// x-real-ip themselves. Defaults to a constant so local dev (no
// proxy headers) doesn't crash.
export function getClientIp(headers: Headers): string {
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}
