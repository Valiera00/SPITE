'use client'

import { useEffect, useState } from 'react'
import { Check, Warning } from '@phosphor-icons/react'
import { SettingField, type Setting } from './setting-field'

// Settings → fal.ai API key. Paste it here (stored encrypted) or set FAL_KEY
// in the host's environment variables; one saved here takes priority.
export function FalKeySection() {
  const [setting, setSetting] = useState<Setting | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/settings/providers/keys?name=FAL_KEY', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSetting(d.setting))
      .catch(() => setError('Couldn’t read the key status.'))
  }, [])

  const save = async (name: string, value: string | null) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/settings/providers/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Couldn’t save. Try again.')
      setSetting(data.setting)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-tour="settings-apikey" className="space-y-4">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">fal.ai API Key</h2>
      <div className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Runs every model, unless Model providers below says otherwise.</p>
          {setting?.source ? (
            <span className="flex items-center gap-1.5 text-xs font-mono text-accent shrink-0">
              <Check size={14} weight="bold" /> Set up
            </span>
          ) : setting ? (
            <span className="flex items-center gap-1.5 text-xs font-mono text-amber-400 shrink-0">
              <Warning size={14} weight="bold" /> Needed to generate
            </span>
          ) : null}
        </div>
        {!setting && !error && <p className="text-xs text-muted-foreground">Checking…</p>}
        {setting && <SettingField s={setting} busy={busy} onSave={save} hideLabel />}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground leading-relaxed pt-3 border-t border-border/50">
          Stored encrypted and never sent back to the browser. You can set{' '}
          <span className="font-mono text-foreground">FAL_KEY</span> in your host&apos;s environment variables
          instead; a key saved here takes priority. Whether the key works shows on your first generation.
        </p>
      </div>
    </section>
  )
}
