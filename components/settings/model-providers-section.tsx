'use client'

import { useEffect, useState } from 'react'
import { Check, Warning } from '@phosphor-icons/react'
import { invalidateRoutedProviders } from '@/lib/use-providers'

// Settings → Model providers. Seedance and Wan can run on fal (the default,
// works with just FAL_KEY) or on their makers' own APIs, which cost less. The
// key lives in an environment variable like FAL_KEY; only the choice is saved
// here. See lib/model-routing.ts.

interface Family {
  id: string
  label: string
  choice: 'fal' | 'direct'
  provider: string
  configured: boolean
  envVars: string[]
  pricing: string
  prices: { model: string; fal: number | null; direct: number | null }[]
}

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

/** "about 50% cheaper", from the family's biggest saving at 1080p. */
function saving(f: Family): number {
  let best = 0
  for (const p of f.prices) if (p.fal && p.direct) best = Math.max(best, 1 - p.direct / p.fal)
  return Math.round(best * 100)
}

// What to put where, per provider. Plain-language, no values.
const SETUP: Record<string, string> = {
  BytePlus:
    'Create a key in the BytePlus ModelArk console and activate the Seedance models there. Add it to your Vercel project as BYTEPLUS_API_KEY, then redeploy.',
  'Alibaba Model Studio':
    'Create a key in Alibaba Cloud Model Studio and add it as DASHSCOPE_API_KEY. For the lower price, use a Frankfurt, Virginia or Tokyo workspace: add its id as DASHSCOPE_WORKSPACE_ID and its region as DASHSCOPE_REGION (eu-central-1, us-east-1 or ap-northeast-1). Without those, the Singapore endpoint is used, priced the same as fal. Redeploy after adding them.',
}

export function ModelProvidersSection() {
  const [families, setFamilies] = useState<Family[] | null>(null)
  const [error, setError] = useState('')
  const [saving_, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setFamilies(d.families))
      .catch(() => setError('Couldn’t load model providers.'))
  }, [])

  const choose = async (family: string, choice: 'fal' | 'direct') => {
    setSaving(family)
    setError('')
    try {
      const res = await fetch('/api/settings/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family, choice }),
      })
      if (!res.ok) throw new Error()
      setFamilies((await res.json()).families)
      invalidateRoutedProviders()
    } catch {
      setError('Couldn’t save. Try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section data-tour="settings-providers" className="space-y-4">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Model providers</h2>
      <div className="glass rounded-xl p-6 space-y-6">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Everything runs on fal by default. Some models are cheaper bought straight from the company that
          makes them: same model, same results, a lower price. Pick where each one runs. If the maker&apos;s
          API is chosen but can&apos;t be reached, SPITE runs the job on fal instead and tells you.
        </p>

        {!families && !error && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {families?.map((f) => {
          const pct = saving(f)
          const direct = f.choice === 'direct'
          return (
            <div key={f.id} className="space-y-3 pt-4 first-of-type:pt-0 border-t first-of-type:border-t-0 border-border/50">
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
                      onClick={() => f.choice !== c && choose(f.id, c)}
                      disabled={saving_ === f.id}
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

              {direct && (f.configured ? (
                <p className="flex items-center gap-1.5 text-xs text-accent">
                  <Check size={14} weight="bold" /> Key set up. {f.label.split(' ')[0]} jobs run on {f.provider}.
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-amber-400 leading-relaxed">
                  <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />
                  <span>No key yet, so these still run on fal. {SETUP[f.provider]}</span>
                </p>
              ))}
              {direct && f.configured && f.pricing === 'alibaba-sg' && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This key uses the Singapore endpoint, which costs the same as fal. {SETUP[f.provider]}
                </p>
              )}
            </div>
          )
        })}

        <p className="text-xs text-muted-foreground leading-relaxed pt-3 border-t border-border/50">
          Keys are never sent to the browser or stored in the database: like FAL_KEY, they live only in your
          Vercel environment variables. Prices are list prices and may change.
        </p>
      </div>
    </section>
  )
}
