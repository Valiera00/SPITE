'use client'

import { useEffect, useState } from 'react'
import { Check, Warning } from '@phosphor-icons/react'

// Settings → Claude connection (MCP). Lets the user's own Claude work in
// SPITE through an access token. Off by default. The token comes back only
// from enable / new token and lives in component state alone: never stored,
// never logged, gone when the block is dismissed or the page is left.

interface McpStatus {
  enabled: boolean
  hint?: string
  createdAt?: string
  lastUsedAt?: string | null
  hourlyLimitUsd: number
}

type McpAction =
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'limit'; hourlyLimitUsd: number }

type CopyTarget = 'token' | 'command' | 'url'

const fmtDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function McpSection() {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Shown once, right after enable / new token. Never persisted.
  const [token, setToken] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [confirmNew, setConfirmNew] = useState(false)
  const [limitDraft, setLimitDraft] = useState('')
  const [limitSaved, setLimitSaved] = useState(false)
  const [copied, setCopied] = useState<CopyTarget | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    fetch('/api/settings/mcp', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: McpStatus) => {
        setStatus(d)
        setLimitDraft(String(d.hourlyLimitUsd))
      })
      .catch(() => setError('Couldn’t read the connection status.'))
  }, [])

  const post = async (body: McpAction): Promise<(McpStatus & { token?: string }) | null> => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/settings/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Couldn’t save. Try again.')
      const next = data as McpStatus & { token?: string }
      // Keep the token out of the stored status object.
      setStatus({
        enabled: next.enabled,
        hint: next.hint,
        createdAt: next.createdAt,
        lastUsedAt: next.lastUsedAt,
        hourlyLimitUsd: next.hourlyLimitUsd,
      })
      return next
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const enable = async () => {
    setConfirmNew(false)
    setToken(null)
    setCopied(null)
    const next = await post({ action: 'enable' })
    if (next?.token) setToken(next.token)
  }

  const disable = async () => {
    setConfirmNew(false)
    const next = await post({ action: 'disable' })
    if (next) {
      setToken(null)
      setCopied(null)
    }
  }

  const saveLimit = async () => {
    const n = Number(limitDraft)
    if (limitDraft.trim() === '' || !Number.isFinite(n) || n < 0) {
      setError('Enter an amount of 0 or more.')
      return
    }
    setLimitSaved(false)
    const next = await post({ action: 'limit', hourlyLimitUsd: n })
    if (next) {
      setLimitDraft(String(next.hourlyLimitUsd))
      setLimitSaved(true)
      setTimeout(() => setLimitSaved(false), 2500)
    }
  }

  const copy = async (what: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000)
    } catch {
      setError('Couldn’t copy. Select the text and copy it yourself.')
    }
  }

  const endpoint = `${origin}/api/mcp`
  const command = token
    ? `claude mcp add --transport http --scope user spite ${endpoint} --header "Authorization: Bearer ${token}"`
    : ''

  const copyButton = (what: CopyTarget, text: string) => (
    <button
      onClick={() => copy(what, text)}
      className="shrink-0 px-3 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
    >
      {copied === what ? 'Copied' : 'Copy'}
    </button>
  )

  const fieldClass =
    'flex-1 min-w-0 px-3 py-2 text-sm font-mono rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none'

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Claude connection (MCP)</h2>
      <div className="glass rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-foreground">Let your own Claude work in SPITE.</p>
          {status?.enabled ? (
            <span className="flex items-center gap-1.5 text-xs font-mono text-accent shrink-0">
              <Check size={14} weight="bold" /> On
            </span>
          ) : status ? (
            <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground shrink-0">
              <Warning size={14} weight="bold" /> Off
            </span>
          ) : null}
        </div>

        {!status && !error && <p className="text-xs text-muted-foreground">Checking…</p>}

        {status && !status.enabled && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Turn this on to connect Claude Code or another Claude app to SPITE. You get an access token to add
              to Claude. Turn it off any time and the token stops working.
            </p>
            <button
              onClick={enable}
              disabled={busy}
              className="px-4 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Turning on…' : 'Turn on'}
            </button>
          </div>
        )}

        {status?.enabled && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {status.hint && (
                <>Token ends <span className="font-mono text-foreground">…{status.hint}</span> · </>
              )}
              {status.createdAt && <>Created {fmtDate(status.createdAt)} · </>}
              {status.lastUsedAt ? <>Last used {fmtDate(status.lastUsedAt)}</> : <>Not used yet</>}
            </p>

            {!confirmNew ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setConfirmNew(true)}
                  disabled={busy}
                  className="px-3 py-2 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  New token
                </button>
                <button
                  onClick={disable}
                  disabled={busy}
                  className="px-3 py-2 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  {busy ? 'Working…' : 'Turn off'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/30">
                <p className="text-xs text-muted-foreground">
                  Your current token stops working right away. You&apos;ll need to add the new one to Claude.
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setConfirmNew(false)}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={enable}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-40"
                  >
                    {busy ? 'Making…' : 'Make new token'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {token && (
          <div className="space-y-3 p-3 rounded-lg bg-accent/5 border border-accent/30">
            <p className="text-xs text-foreground">Copy your token now. It won&apos;t be shown again.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={token}
                aria-label="Access token"
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                className={fieldClass}
              />
              {copyButton('token', token)}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">For Claude Code, run this in your terminal:</p>
              <div className="flex gap-2">
                <textarea
                  readOnly
                  value={command}
                  aria-label="Claude Code command"
                  spellCheck={false}
                  rows={3}
                  onFocus={(e) => e.target.select()}
                  className={`${fieldClass} text-xs resize-none break-all`}
                />
                {copyButton('command', command)}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">For other Claude apps, use this address with the token:</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={endpoint}
                  aria-label="Connection address"
                  spellCheck={false}
                  onFocus={(e) => e.target.select()}
                  className={fieldClass}
                />
                {copyButton('url', endpoint)}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => { setToken(null); setCopied(null) }}
                className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
              >
                Done, hide it
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className="space-y-1.5 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="mcp-hourly-limit" className="text-sm text-foreground">
                Most Claude may spend per hour
              </label>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono text-muted-foreground/70">$</span>
                <input
                  id="mcp-hourly-limit"
                  type="number"
                  min={0}
                  step={0.5}
                  inputMode="decimal"
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveLimit() }}
                  disabled={busy}
                  className="w-20 px-2 py-1 text-xs font-mono text-right rounded-md bg-background/60 border border-border/50 focus:border-accent/50 outline-none disabled:opacity-50"
                />
                <button
                  onClick={saveLimit}
                  disabled={busy || limitDraft === String(status.hourlyLimitUsd)}
                  className="px-3 py-1 text-xs font-mono rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-40"
                >
                  {limitSaved ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This is on top of SPITE&apos;s normal spend limit, and Claude can&apos;t change it. Set it to 0 and
              Claude can look around but not generate.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-2 pt-3 border-t border-border/50">
          <div className="space-y-1">
            <p className="text-xs text-foreground">Claude can</p>
            <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4">
              <li>See your projects, folders and models</li>
              <li>Generate images and video into a project</li>
              <li>Put shots you keep onto the board</li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground">Claude can&apos;t</p>
            <ul className="text-xs text-muted-foreground leading-relaxed list-disc pl-4">
              <li>Delete anything</li>
              <li>Change settings</li>
              <li>See your API keys</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
