'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, X } from '@phosphor-icons/react'
import {
  getConnectorAnimation,
  setConnectorAnimation,
  type ConnectorAnimation,
} from '@/lib/connector-animation'
import { OnboardingTour } from '@/components/onboarding/use-onboarding-tour'
import { startTour } from '@/lib/onboarding'

export default function SettingsPage() {
  // API Key state
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'connected' | 'not_set' | 'invalid'>('checking')
  const [keyPreview, setKeyPreview] = useState('')
  const [testingConnection, setTestingConnection] = useState(false)

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)

  // Danger zone state. Both actions require the user to type the
  // matching phrase before the button enables — defense against a stray
  // click wiping a project mid-job.
  const [showClearCanvasConfirm, setShowClearCanvasConfirm] = useState(false)
  const [showClearAssetsConfirm, setShowClearAssetsConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [canvasConfirmText, setCanvasConfirmText] = useState('')
  const [assetsConfirmText, setAssetsConfirmText] = useState('')
  const CLEAR_CANVAS_PHRASE = 'DELETE ALL CANVAS DATA'
  const CLEAR_ASSETS_PHRASE = 'DELETE ALL ASSETS'

  // Recovery state — hits /api/generate/recover in bulk mode to pull
  // back any generations whose result vanished from the canvas but
  // still exists on fal's side (within their ~24h retention window).
  const [recovering, setRecovering] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<string | null>(null)

  // Canvas connector-animation preference (persisted in localStorage).
  const [connectorAnim, setConnectorAnimState] = useState<ConnectorAnimation>('auto')

  // R2 storage usage for the storage bar.
  const [storage, setStorage] = useState<{ usedBytes: number; objectCount: number; freeTierBytes: number } | null>(null)
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading')

  // Effective data-retention windows (configured via env, surfaced here).
  const [retention, setRetention] = useState<{ assetRetentionDays: number; referenceRetentionDays: number } | null>(null)

  // Check API key + load preferences on mount
  useEffect(() => {
    checkApiKey()
    setConnectorAnimState(getConnectorAnimation())
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings/storage')
        if (!res.ok) throw new Error('storage fetch failed')
        const data = await res.json()
        if (!cancelled) { setStorage(data); setStorageState('ready') }
      } catch {
        if (!cancelled) setStorageState('error')
      }
    })()
    ;(async () => {
      try {
        const res = await fetch('/api/settings/retention')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setRetention(data)
      } catch { /* non-critical */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Bytes → human-readable (B / KB / MB / GB).
  const fmtBytes = (bytes: number) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0, n = bytes
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
  }

  const changeConnectorAnim = (v: ConnectorAnimation) => {
    setConnectorAnimState(v)
    setConnectorAnimation(v)
  }

  const checkApiKey = async () => {
    try {
      const res = await fetch('/api/generate/test', { method: 'POST' })
      const data = await res.json()
      if (data.connected) {
        setApiKeyStatus('connected')
        setKeyPreview(data.keyPreview)
      } else if (data.error?.includes('not set')) {
        setApiKeyStatus('not_set')
      } else {
        setApiKeyStatus('invalid')
      }
    } catch {
      setApiKeyStatus('not_set')
    }
  }

  const testConnection = async () => {
    setTestingConnection(true)
    await checkApiKey()
    setTestingConnection(false)
  }

  const handlePasswordChange = async () => {
    setPasswordError('')
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }

    setChangingPassword(true)
    try {
      const res = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (res.ok) {
        setPasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordError(data.error || 'Failed to change password')
      }
    } catch {
      setPasswordError('Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const clearAllCanvasData = async () => {
    if (canvasConfirmText !== CLEAR_CANVAS_PHRASE) return
    setClearing(true)
    try {
      const res = await fetch('/api/settings/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'canvas', confirm: canvasConfirmText }),
      })
      if (res.ok) {
        setShowClearCanvasConfirm(false)
        setCanvasConfirmText('')
      }
    } catch (error) {
      console.error('Failed to clear canvas data:', error)
    } finally {
      setClearing(false)
    }
  }

  const handleBackfillRecent = async () => {
    if (recovering) return
    setRecovering(true)
    setRecoveryResult(null)
    try {
      const res = await fetch('/api/generate/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'backfill-recent', withinHours: 24 }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRecoveryResult(`Backfill failed: ${data.error || res.status}`)
        return
      }
      const marked = data.marked ?? 0
      setRecoveryResult(
        marked === 0
          ? 'Nothing to backfill — every recent asset already has the recovered flag (or there are none from the last 24h).'
          : `Marked ${marked} asset${marked === 1 ? '' : 's'} from the last 24h as recovered. Their badges should appear in the library shortly.`,
      )
    } catch (err) {
      console.error('Backfill error:', err)
      setRecoveryResult('Backfill request failed. Check the console.')
    } finally {
      setRecovering(false)
    }
  }

  const handleRecoverStuck = async () => {
    if (recovering) return
    setRecovering(true)
    setRecoveryResult(null)
    try {
      const res = await fetch('/api/generate/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        setRecoveryResult(`Recovery failed: ${data.error || res.status}`)
        return
      }
      const scanned = data.scanned ?? 0
      const recovered = data.recovered ?? 0
      const stillPending = data.stillPending ?? 0
      const failed = data.failed ?? 0
      const notFound = data.notFound ?? 0
      if (scanned === 0) {
        setRecoveryResult('No stuck generations found. You’re clean.')
      } else {
        const parts: string[] = []
        if (recovered > 0) parts.push(`${recovered} recovered`)
        if (stillPending > 0) parts.push(`${stillPending} still running on fal`)
        if (failed > 0) parts.push(`${failed} failed on fal`)
        if (notFound > 0) parts.push(`${notFound} expired from fal (>24h old)`)
        setRecoveryResult(`Scanned ${scanned} stuck node${scanned === 1 ? '' : 's'} — ${parts.join(', ') || 'no changes'}.`)
      }
    } catch (err) {
      console.error('Recovery error:', err)
      setRecoveryResult('Recovery request failed. Check the console.')
    } finally {
      setRecovering(false)
    }
  }

  const clearAllAssets = async () => {
    if (assetsConfirmText !== CLEAR_ASSETS_PHRASE) return
    setClearing(true)
    try {
      const res = await fetch('/api/settings/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'assets', confirm: assetsConfirmText }),
      })
      if (res.ok) {
        setShowClearAssetsConfirm(false)
        setAssetsConfirmText('')
      }
    } catch (error) {
      console.error('Failed to clear assets:', error)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center justify-center w-8 h-8 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} weight="thin" />
          </Link>
          <h1 className="text-lg font-serif tracking-tight">Settings</h1>
          <button
            onClick={() => startTour('settings')}
            className="ml-auto text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            title="Take the settings tour"
          >
            Tour
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
        {/* fal.ai API Key Section */}
        <section data-tour="settings-apikey" className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">fal.ai API Key</h2>
          <div className="glass rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Connection Status</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {apiKeyStatus === 'checking' && 'Checking...'}
                  {apiKeyStatus === 'connected' && `Connected ${keyPreview}`}
                  {apiKeyStatus === 'not_set' && 'API key not configured'}
                  {apiKeyStatus === 'invalid' && 'Invalid API key'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {apiKeyStatus === 'connected' ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono text-accent">
                    <Check size={14} weight="bold" /> Connected
                  </span>
                ) : apiKeyStatus === 'invalid' ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono text-destructive">
                    <X size={14} weight="bold" /> Invalid key
                  </span>
                ) : null}
                <button
                  onClick={testConnection}
                  disabled={testingConnection}
                  className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-border/50">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Add your fal.ai key to your Vercel project under{' '}
                <span className="text-foreground font-mono">Settings → Environment Variables → FAL_KEY</span>, then redeploy.
                The key is never sent to the browser — it lives only in Vercel&apos;s encrypted environment config.
              </p>
            </div>
          </div>
        </section>

        {/* Password Change Section */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">App Password</h2>
          <div className="glass rounded-xl p-6 space-y-4">
            <div className="space-y-3">
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-background/50 border border-border/50 focus:border-accent/50 focus:outline-none transition-colors"
              />
            </div>
            {passwordError && (
              <p className="text-xs text-destructive">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-xs text-accent leading-relaxed">
                Current password verified. The password can&apos;t be changed from
                here at runtime — update <span className="font-mono">APP_PASSWORD</span>{' '}
                in your Vercel environment variables and redeploy to make the new
                one take effect.
              </p>
            )}
            <button
              onClick={handlePasswordChange}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="px-4 py-2 text-xs font-mono rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </section>

        {/* Storage — how much of the R2 free tier is used. */}
        <section data-tour="settings-storage" className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Storage (Cloudflare R2)</h2>
          <div className="glass rounded-xl p-6 space-y-3">
            {storageState === 'loading' && (
              <p className="text-xs text-muted-foreground">Calculating usage…</p>
            )}
            {storageState === 'error' && (
              <p className="text-xs text-destructive">Couldn&apos;t read storage usage.</p>
            )}
            {storageState === 'ready' && storage && (() => {
              const pct = storage.freeTierBytes > 0 ? (storage.usedBytes / storage.freeTierBytes) * 100 : 0
              const over = pct > 100
              const barColor = over ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-accent'
              return (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{fmtBytes(storage.usedBytes)} used</span>
                    <span className={over ? 'text-red-400' : 'text-muted-foreground'}>
                      {Math.round(pct)}% of 10 GB free tier
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-background/60 overflow-hidden">
                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {storage.objectCount.toLocaleString()} files stored. R2&apos;s free tier is 10 GB; beyond that
                    Cloudflare bills about $0.015/GB per month. Serving images (egress) is always free.
                  </p>
                </>
              )
            })()}
          </div>
        </section>

        {/* Data Retention — what the nightly cleanup cron deletes, and when.
            Values come from env vars and are surfaced here so it's unambiguous
            what will and won't be removed. */}
        <section data-tour="settings-retention" className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Data Retention</h2>
          <div className="glass rounded-xl p-6 space-y-5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              By default <span className="text-foreground/80">nothing is ever auto-deleted</span> —
              both windows below are fully opt-in. A cleanup job runs once a day (04:00 UTC)
              and only acts on a category once you&apos;ve set a number of days for it. It only
              ever touches the two categories below; <span className="text-foreground/80">anything
              you place on a canvas is permanent</span> regardless.
            </p>

            {/* Unused results */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-foreground">Unused results</p>
                <span className="shrink-0 text-xs font-mono px-2 py-0.5 rounded-md bg-background/60 border border-border/50 text-foreground/80">
                  {retention
                    ? retention.assetRetentionDays > 0
                      ? `Delete after ${retention.assetRetentionDays} days`
                      : 'Never delete'
                    : '…'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Generated images/videos that you never added to a canvas (left only in the
                library) are deleted once they pass this age, freeing storage. The moment a
                result is dropped onto a canvas it becomes permanent and this no longer applies.
                Controlled by <span className="text-foreground font-mono">ASSET_RETENTION_DAYS</span>{' '}
                (default 0 = keep forever; set e.g. 30 to prune after a month — any number works).
              </p>
            </div>

            {/* Reference inputs */}
            <div className="space-y-1.5 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-foreground">Reference inputs</p>
                <span className="shrink-0 text-xs font-mono px-2 py-0.5 rounded-md bg-background/60 border border-border/50 text-foreground/80">
                  {retention
                    ? retention.referenceRetentionDays > 0
                      ? `Reclaim after ${retention.referenceRetentionDays} days`
                      : 'Never delete'
                    : '…'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Reference images you attach to a prompt are inputs, not outputs. After this
                many days they&apos;re reclaimed from storage; the generated results they
                produced are <span className="text-foreground/80">never</span> affected. Once a
                reference is gone, &ldquo;Reuse&rdquo; can no longer re-attach it. Controlled by{' '}
                <span className="text-foreground font-mono">REFERENCE_RETENTION_DAYS</span>{' '}
                (default 0 = never; set e.g. 7 for weekly reclaim — any number works).
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground/80 leading-relaxed pt-3 border-t border-border/50">
              These are set as environment variables in your host (e.g. Vercel →
              Settings → Environment Variables) and take effect on the next deploy —
              the same as your API key and app password. Changing the number only
              affects which items the <em>next</em> nightly run considers expired.
            </p>
          </div>
        </section>

        {/* Recovery — pull back generations whose result vanished from the
            canvas (failed poll, refresh mid-gen, soft timeout, etc.). fal
            keeps results around for ~24h so a job that finished off-screen
            is usually still retrievable as long as we have its request id. */}
        <section data-tour="settings-recovery" className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-foreground/80">Recovery</h2>
          <div className="glass rounded-xl border border-border/30 p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">Recover stuck generations</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Scans every project for nodes whose generation got stuck (the spinner that won&apos;t end). Any job fal has actually completed will be pulled into your assets library; jobs still running are reported back unchanged. Safe to run anytime — fal&apos;s status check is free.
                </p>
                {recoveryResult && (
                  <p className="text-xs text-foreground/80 mt-2 font-mono">
                    {recoveryResult}
                  </p>
                )}
              </div>
              <button
                onClick={handleRecoverStuck}
                disabled={recovering}
                className="shrink-0 px-3 py-1.5 text-xs font-mono rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                {recovering ? 'Scanning…' : 'Recover'}
              </button>
            </div>

            {/* Backfill — mark every recent asset as 'recovered' so the
                badge appears on assets that were recovered before the
                badge feature shipped. Operates over the last 24 hours
                by default. */}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/30">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">Backfill badges</p>
                <p className="text-xs text-muted-foreground mt-1">
                  One-shot: flag every asset from the last 24 hours as recovered, so the blue badge appears on assets you recovered before the badge feature existed. Safe to run multiple times — already-flagged assets are skipped.
                </p>
              </div>
              <button
                onClick={handleBackfillRecent}
                disabled={recovering}
                className="shrink-0 px-3 py-1.5 text-xs font-mono rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-300 hover:bg-blue-500/25 transition-colors disabled:opacity-50"
              >
                {recovering ? 'Working…' : 'Backfill'}
              </button>
            </div>
          </div>
        </section>

        {/* Performance — canvas connector animation */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Performance</h2>
          <div className="glass rounded-xl p-6 space-y-4">
            <div>
              <p className="text-sm text-foreground">Animated connectors</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                The braided cords between nodes can gently drift and glow.{' '}
                <span className="text-foreground/80">Auto</span> animates every cord on
                smaller canvases and automatically freezes idle cords once a canvas gets
                large (only the ones you hover or select keep moving).{' '}
                <span className="text-foreground/80">Always on</span> keeps them all
                animating regardless of size. <span className="text-foreground/80">Off</span>{' '}
                makes them fully static — best for low-end machines or saving battery.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {([
                { value: 'auto', label: 'Auto' },
                { value: 'on', label: 'Always on' },
                { value: 'off', label: 'Off' },
              ] as { value: ConnectorAnimation; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => changeConnectorAnim(opt.value)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                    connectorAnim === opt.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'glass-hover text-muted-foreground border-border/50 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wider text-destructive">Danger Zone</h2>
          <div className="glass rounded-xl border border-destructive/20 p-6 space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">Clear all canvas data</p>
                  <p className="text-xs text-muted-foreground mt-1">Delete all projects and pages from the database</p>
                </div>
                {!showClearCanvasConfirm && (
                  <button
                    onClick={() => setShowClearCanvasConfirm(true)}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Clear Data
                  </button>
                )}
              </div>
              {showClearCanvasConfirm && (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono text-destructive">{CLEAR_CANVAS_PHRASE}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={canvasConfirmText}
                    onChange={(e) => setCanvasConfirmText(e.target.value)}
                    placeholder={CLEAR_CANVAS_PHRASE}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-background border border-border/50 focus:border-destructive outline-none"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => {
                        setShowClearCanvasConfirm(false)
                        setCanvasConfirmText('')
                      }}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={clearAllCanvasData}
                      disabled={clearing || canvasConfirmText !== CLEAR_CANVAS_PHRASE}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clearing ? 'Clearing...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border/50" />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-foreground">Clear all assets</p>
                  <p className="text-xs text-muted-foreground mt-1">Delete all assets and their storage files</p>
                </div>
                {!showClearAssetsConfirm && (
                  <button
                    onClick={() => setShowClearAssetsConfirm(true)}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Clear Assets
                  </button>
                )}
              </div>
              {showClearAssetsConfirm && (
                <div className="flex flex-col gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono text-destructive">{CLEAR_ASSETS_PHRASE}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={assetsConfirmText}
                    onChange={(e) => setAssetsConfirmText(e.target.value)}
                    placeholder={CLEAR_ASSETS_PHRASE}
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-background border border-border/50 focus:border-destructive outline-none"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => {
                        setShowClearAssetsConfirm(false)
                        setAssetsConfirmText('')
                      }}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg glass-hover text-muted-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={clearAllAssets}
                      disabled={clearing || assetsConfirmText !== CLEAR_ASSETS_PHRASE}
                      className="px-3 py-1.5 text-xs font-mono rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {clearing ? 'Clearing...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <OnboardingTour surface="settings" />
    </div>
  )
}
