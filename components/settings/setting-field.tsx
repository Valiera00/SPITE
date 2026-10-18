'use client'

import { useState } from 'react'

// One pasteable setting (an API key, Alibaba's workspace id or region) in
// Settings. Saved encrypted through /api/settings/providers/keys; the server
// only ever sends back where a value comes from and its last four characters.
// See lib/provider-secrets.ts.

export interface Setting {
  name: string
  secret: boolean
  source: 'settings' | 'env' | null
  hint?: string
  unreadable?: boolean
}

const FIELD: Record<string, { label: string; placeholder: string; help?: string }> = {
  FAL_KEY: {
    label: 'fal.ai API key',
    placeholder: 'Paste your key',
    help: 'fal.ai → Dashboard → Keys.',
  },
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

export function SettingField({
  s,
  onSave,
  busy,
  hideLabel,
}: {
  s: Setting
  onSave: (name: string, value: string | null) => Promise<boolean>
  busy: boolean
  hideLabel?: boolean
}) {
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
        {!hideLabel && <label className="text-xs text-foreground">{meta.label}</label>}
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
      {!hideLabel && <label className="text-xs text-foreground">{meta.label}</label>}
      <div className="flex gap-2">
        <input
          type={s.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          aria-label={meta.label}
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
