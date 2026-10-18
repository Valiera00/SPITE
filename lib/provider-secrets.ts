// API keys pasted in Settings instead of set as environment variables: fal's,
// and those of the model makers' own APIs (Settings → Model providers), plus
// Alibaba's workspace id and region. A value saved here wins over the environment variable of the
// same name; with neither, the provider counts as not set up.
//
// Values are encrypted (AES-256-GCM) before they reach the database, with a
// key derived from APP_PASSWORD, which never is in the database. A copy of
// the database alone doesn't reveal them. Changing APP_PASSWORD makes saved
// values unreadable: Settings then says so and asks for them again.
// Nothing here ever returns a secret to the browser; describeSetting() gives
// only where it came from and its last four characters.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { getDb } from './db'

export const SETTING_NAMES = ['FAL_KEY', 'BYTEPLUS_API_KEY', 'DASHSCOPE_API_KEY', 'DASHSCOPE_WORKSPACE_ID', 'DASHSCOPE_REGION'] as const
export type SettingName = (typeof SETTING_NAMES)[number]

const SECRET: Record<SettingName, boolean> = {
  FAL_KEY: true,
  BYTEPLUS_API_KEY: true,
  DASHSCOPE_API_KEY: true,
  DASHSCOPE_WORKSPACE_ID: false,
  DASHSCOPE_REGION: false,
}

export const ALIBABA_REGIONS = ['ap-southeast-1', 'eu-central-1', 'us-east-1', 'ap-northeast-1'] as const

export function isSettingName(n: unknown): n is SettingName {
  return typeof n === 'string' && (SETTING_NAMES as readonly string[]).includes(n)
}

/** Why a value can't be saved, or null if it can. */
export function invalidValue(name: SettingName, value: string): string | null {
  if (name === 'DASHSCOPE_REGION') return (ALIBABA_REGIONS as readonly string[]).includes(value) ? null : 'Unknown region.'
  if (name === 'DASHSCOPE_WORKSPACE_ID') return /^[A-Za-z0-9-]{3,64}$/.test(value) ? null : 'A workspace id is letters, digits and dashes.'
  // API keys: printable, no spaces, a sane length.
  return /^[\x21-\x7e]{8,300}$/.test(value) ? null : 'That doesn’t look like an API key (no spaces, 8–300 characters).'
}

let cipherKey: { pw: string; key: Buffer } | null = null
function key(): Buffer {
  const pw = process.env.APP_PASSWORD?.trim()
  if (!pw) throw new Error('APP_PASSWORD is not set')
  if (cipherKey?.pw !== pw) cipherKey = { pw, key: scryptSync(pw, 'spite-provider-secrets-v1', 32) }
  return cipherKey.key
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}

export function decrypt(stored: string): string | null {
  try {
    const [v, iv, tag, body] = stored.split('.')
    if (v !== 'v1') return null
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null // wrong APP_PASSWORD, or tampered
  }
}

// name → decrypted value, or null when saved but unreadable.
type Saved = Map<SettingName, string | null>
let cache: { at: number; saved: Saved } | null = null
const TTL_MS = 30_000

let tableReady = false
async function ensureTable(sql: ReturnType<typeof getDb>) {
  if (tableReady) return
  await sql`CREATE TABLE IF NOT EXISTS provider_secrets (
    name text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  tableReady = true
}

async function loadSaved(): Promise<Saved> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.saved
  const saved: Saved = new Map()
  try {
    const sql = getDb()
    await ensureTable(sql)
    const rows = await sql`SELECT name, value FROM provider_secrets`
    for (const r of rows) if (isSettingName(r.name)) saved.set(r.name, decrypt(String(r.value)))
  } catch (err) {
    // Database unavailable: environment variables still work.
    console.error('[provider-secrets] could not read saved settings:', err instanceof Error ? err.message : err)
  }
  cache = { at: Date.now(), saved }
  return saved
}

/** The value in use: saved in Settings, else the environment variable. */
export async function getSetting(name: SettingName): Promise<string | undefined> {
  const saved = (await loadSaved()).get(name)
  if (saved) return saved
  return process.env[name]?.trim() || undefined
}

export interface SettingInfo {
  name: SettingName
  secret: boolean
  /** Where the value in use comes from. */
  source: 'settings' | 'env' | null
  /** Last four characters of a secret, or the whole value of a non-secret. */
  hint?: string
  /** Saved in Settings but can't be decrypted (APP_PASSWORD changed). */
  unreadable?: boolean
}

export async function describeSetting(name: SettingName): Promise<SettingInfo> {
  const saved = await loadSaved()
  const secret = SECRET[name]
  const show = (v: string) => (secret ? `…${v.slice(-4)}` : v)
  const s = saved.get(name)
  if (s) return { name, secret, source: 'settings', hint: show(s) }
  const env = process.env[name]?.trim()
  const unreadable = saved.has(name) && s === null ? true : undefined
  if (env) return { name, secret, source: 'env', hint: show(env), unreadable }
  return { name, secret, source: null, unreadable }
}

/** Save a value, or remove the saved one with null (the env var, if any, applies again). */
export async function saveSetting(name: SettingName, value: string | null): Promise<void> {
  const sql = getDb()
  await ensureTable(sql)
  if (value === null) {
    await sql`DELETE FROM provider_secrets WHERE name = ${name}`
  } else {
    const enc = encrypt(value)
    await sql`INSERT INTO provider_secrets (name, value, updated_at) VALUES (${name}, ${enc}, now())
              ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  }
  cache = null
}
