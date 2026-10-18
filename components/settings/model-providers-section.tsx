'use client'

import { useEffect, useState } from 'react'
import { Check, Warning } from '@phosphor-icons/react'
import { invalidateRoutedProviders } from '@/lib/use-providers'

// Settings → Model providers. Seedance and Wan can run on fal (the default,
// works with just FAL_KEY) or on their makers' own APIs, which cost less.
// Their keys are pasted here (stored encrypted, never sent back to the
// browser) or set as Vercel environment variables. See lib/model-routing.ts
// and lib/provider-secrets.ts.

interface Setting {
  name: string
  secret: boolean
  source: 'settings' | 'env' | null
  hint?: string
  unreadable?: boolean
}

interface Family {
  id: string
  label: string
  choice: 'fal' | 'direct'
  provider: string
  configured: boolean
  pricing: string
  settings: Setting[]
  prices: { model: string; fal: number | null; direct: number | null }[]
}

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

/** "about 50% cheaper", from the family's biggest saving at 1080p. */
function saving(f: Family): number {
  let best = 0
  for (const p of f.prices) if (p.fal && p.direct) best = Math.max(best, 1 - p.direct / p.fal)
  return Math.round(best * 100)
}

const FIELD: Record<string, { label: string; placeholder: string; help?: string }> = {
  BYTEPLUS_API_KEY: {
    label: 'BytePlus API key',
    placeholder: 'Paste your key',
    help: 'BytePlus console → ModelArk → API keys. Activate the Seedance models there too.',
  },
  DASHSCOPE_API_KEY: {
    label: 'Alibaba API key',
    placeholder: 'sk-…',
    help: 'Alibaba Cloud Model Studio → API keys.',
  },
  DASHSCOPE_WORKSPACE_ID: {
    label: 'Workspace ID',
    placeholder: 'Only needed outside Singapore',
    help: 'Model Studio → your workspace’s details. Needed for Frankfurt, Virginia or Tokyo.',
  },
  DASHSCOPE_REGION: { label: 'Region', placeholder: '' },
}

const REGIONS: { id: string; label: string }[] = [
  { id: 'ap-southeast-1', label: 'Singapore (same price as fal)' },
  { id: 'eu-central-1', label: 'Frankfurt (cheaper)' },
  { id: 'us-east-1', label: 'Virginia (cheaper)' },
  { id: 'ap-northeast-1', label: 'Tokyo (cheaper)' },
]

function SettingField({ s, onSave, busy }: { s: Setting; onSave: (name: string, value: string | null) => Promise<boolean>; busy: boolean }) {
  const [value, setValue] = useState('')
  const meta = FIELD[s.name] || { label: s.name, placeholder: '' }

  const status =
    s.unreadable && s.source !== 'settings' ? (
      <span className="text-amber-400">The saved value can&apos;t be read (the app password changed). Paste it again.</span>
    ) : s.source === 'settings' ? (
      <span className="text-accent">Saved{s.secret && s.hint ? ` · ends ${s.hint.slice(1)}` : ''}</span>
    ) : s.source === 'env' ? (
      <span>From Vercel environment variables{s.secret && s.hint ? ` · ends ${s.hint.slice(1)}` : ''}. Paste one here to override.</span>
    ) : (
      <span>Not set</span>
    )

  if (s.name === 'DASHSCOPE_REGION') {
    const current = s.hint || 'ap-southeast-1'
    return (
      <div className="space-y-1.5">
        <label className="text-xs text-foreground">{meta.label}</label>
        <select
          value={current}
          disabled={busy}
          onChange={(e) => onSave(s.name, e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none disabled:opacity-50"
        >
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <p className="text-[11px] text-muted-foreground">Where your Model Studio workspace is. Frankfurt, Virginia and Tokyo also need the workspace ID.</p>
      </div>
    )
  }

  const save = async () => {
    if (await onSave(s.name, value)) setValue('')
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-foreground">{meta.label}</label>
      <div className="flex gap-2">
        <input
          type={s.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={s.source === 'settings' && s.secret ? '••••••••  (saved — paste to replace)' : meta.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) save() }}
          className="flex-1 min-w-0 px-3 py-2 text-sm font-mono rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none"
        />
        <button
          onClick={save}
          disabled={busy || !value.trim()}
          className="px-3 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-40"
        >
          Save
        </button>
        {s.source === 'settings' && (
          <button
            onClick={() => onSave(s.name, null)}
            disabled={busy}
            className="px-3 py-2 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {status}
        {s.source !== 'settings' && meta.help ? <> · {meta.help}</> : null}
        {s.source === 'settings' && !s.secret && s.hint ? <> · {s.hint}</> : null}
      </p>
    </div>
  )
}

export function ModelProvidersSection() {
  const [families, setFamilies] = useState<Family[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setFamilies(d.families))
      .catch(() => setError('Couldn’t load model providers.'))
  }, [])

  const post = async (family: string, url: string, body: unknown): Promise<boolean> => {
    setBusy(family)
    setError('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Couldn’t save. Try again.')
      setFamilies(data.families)
      invalidateRoutedProviders()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save. Try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <section data-tour="settings-providers" className="space-y-4">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Model providers</h2>
      <div className="glass rounded-xl p-6 space-y-6">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Everything runs on fal by default. Some models are cheaper bought straight from the company that
          makes them: same model, same results, a lower price. Pick where each one runs and paste the key.
          If the maker&apos;s API can&apos;t take a job, SPITE runs it on fal instead and tells you.
        </p>

        {!families && !error && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {families?.map((f) => {
          const pct = saving(f)
          const direct = f.choice === 'direct'
          return (
            <div key={f.id} className="space-y-4 pt-5 first-of-type:pt-0 border-t first-of-type:border-t-0 border-border/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-foreground">{f.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pct > 0 ? `About ${pct}% cheaper on ${f.provider}` : `Same price on ${f.provider} with the current setup`}
                  </p>
                </div>
                <div className="flex rounded-lg bg-background/50 border border-border/50 p-0.5 text-xs font-mono">
                  {(['fal', 'direct'] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => f.choice !== c && post(f.id, '/api/settings/providers', { family: f.id, choice: c })}
                      disabled={busy === f.id}
                      className={`px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                        f.choice === c ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {c === 'fal' ? 'fal' : f.provider}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 text-xs font-mono">
                <span className="text-muted-foreground">1080p, per second</span>
                <span className="text-muted-foreground text-right">fal</span>
                <span className="text-muted-foreground text-right">{f.provider}</span>
                {f.prices.map((p) => (
                  <div key={p.model} className="contents">
                    <span className="text-foreground">{p.model}</span>
                    <span className={`text-right ${direct ? 'text-muted-foreground' : 'text-foreground'}`}>{p.fal != null ? usd(p.fal) : '–'}</span>
                    <span className={`text-right ${direct ? 'text-accent' : 'text-foreground'}`}>{p.direct != null ? usd(p.direct) : '–'}</span>
                  </div>
                ))}
              </div>

              {direct && (
                <div className="space-y-4 rounded-lg bg-background/30 border border-border/40 p-4">
                  {f.settings.map((s) => (
                    <SettingField
                      key={s.name}
                      s={s}
                      busy={busy === f.id}
                      onSave={(name, value) => post(f.id, '/api/settings/providers/keys', { name, value })}
                    />
                  ))}
                  {f.configured ? (
                    <p className="flex items-center gap-1.5 text-xs text-accent">
                      <Check size={14} weight="bold" /> Set up. {f.label.split(' ')[0]} jobs now run on {f.provider}.
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-amber-400">
                      <Warning size={14} weight="bold" className="shrink-0" /> No key yet, so these still run on fal.
                    </p>
                  )}
                  {f.configured && f.pricing === 'alibaba-sg' && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Singapore costs the same as fal. Use a Frankfurt, Virginia or Tokyo workspace for the lower price.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}

        <p className="text-xs text-muted-foreground leading-relaxed pt-3 border-t border-border/50">
          Keys are stored encrypted and never sent back to the browser. You can set them as Vercel environment
          variables instead; one saved here takes priority. Prices are list prices and may change.
        </p>
      </div>
    </section>
  )
}
