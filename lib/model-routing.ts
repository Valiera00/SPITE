// Which provider runs a model: fal by default, or the maker's own API when
// chosen in Settings → Model providers (stored in app_settings) and its key is
// set (pasted in Settings, encrypted — lib/provider-secrets.ts — or as an
// environment variable).

import { getDb } from './db'
import { byteplusProvider } from './byteplus'
import { alibabaProvider } from './alibaba'
import type { DirectProvider, PricingProvider } from './direct-provider'

export type Family = 'seedance' | 'wan'
export type Choice = 'fal' | 'direct'

export const FAMILIES: Record<Family, { label: string; models: string[]; provider: DirectProvider }> = {
  seedance: { label: 'Seedance (ByteDance)', models: ['seedance-2.0', 'seedance-2.5'], provider: byteplusProvider },
  wan: { label: 'Wan (Alibaba)', models: ['wan-3.0'], provider: alibabaProvider },
}

const PROVIDERS: DirectProvider[] = [byteplusProvider, alibabaProvider]

let tableReady = false
async function ensureTable(sql: ReturnType<typeof getDb>) {
  if (tableReady) return
  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
  tableReady = true
}

/** Every family's current choice; fal unless set otherwise. */
export async function getChoices(): Promise<Record<Family, Choice>> {
  const choices: Record<Family, Choice> = { seedance: 'fal', wan: 'fal' }
  try {
    const sql = getDb()
    await ensureTable(sql)
    const rows = await sql`SELECT key, value FROM app_settings WHERE key LIKE 'provider_%'`
    for (const r of rows) {
      const fam = String(r.key).slice('provider_'.length) as Family
      if (fam in choices && (r.value === 'fal' || r.value === 'direct')) choices[fam] = r.value
    }
  } catch (err) {
    // Can't read the choice → fal, which always works.
    console.error('[model-routing] could not read provider choices, using fal:', err)
  }
  return choices
}

export async function setChoice(family: Family, choice: Choice): Promise<void> {
  const sql = getDb()
  await ensureTable(sql)
  await sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${'provider_' + family}, ${choice}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
}

export function familyOf(modelId: string): Family | null {
  for (const [f, def] of Object.entries(FAMILIES)) if (def.models.includes(modelId)) return f as Family
  return null
}

export type Route =
  | { kind: 'fal' }
  | { kind: 'direct'; provider: DirectProvider; providerModel: string }
  /** The maker's API was chosen but can't be used; runs on fal and says why. */
  | { kind: 'fal-instead'; provider: DirectProvider; reason: string }

export async function resolveRoute(modelId: string): Promise<Route> {
  const family = familyOf(modelId)
  if (!family) return { kind: 'fal' }
  const choices = await getChoices()
  if (choices[family] !== 'direct') return { kind: 'fal' }
  const provider = FAMILIES[family].provider
  if (!(await provider.configured())) return { kind: 'fal-instead', provider, reason: provider.missingConfig() }
  const providerModel = provider.modelFor(modelId)
  if (!providerModel) return { kind: 'fal' }
  return { kind: 'direct', provider, providerModel }
}

/**
 * The direct provider a stored pseudo-endpoint belongs to, if any. Each
 * prefix must stay clear of fal's own namespaces (fal-ai/, alibaba/,
 * bytedance/, …): anything matched here is never polled on fal.
 */
export function providerForEndpoint(endpoint: unknown): DirectProvider | null {
  if (typeof endpoint !== 'string') return null
  return PROVIDERS.find((p) => endpoint.startsWith(p.prefix)) || null
}

/** Model id → price table, for every model that will actually run direct. */
export async function routedPricing(): Promise<Record<string, PricingProvider>> {
  const out: Record<string, PricingProvider> = {}
  const choices = await getChoices()
  for (const [f, def] of Object.entries(FAMILIES)) {
    if (choices[f as Family] !== 'direct' || !(await def.provider.configured())) continue
    const pricing = await def.provider.pricingId()
    for (const m of def.models) if (def.provider.modelFor(m)) out[m] = pricing
  }
  return out
}
