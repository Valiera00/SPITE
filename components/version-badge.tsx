'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Faint "which build am I on?" marker. Shows the app version plus a build stamp
// (e.g. `v0.2.0 · 30 Jul 21:47`) rather than the commit SHA: a hash is random to
// read, so it can't answer "did my refresh pick up the new build?" at a glance,
// while an ordered timestamp can. Hover for the exact commit.
//
// It also doubles as the update notice: when a newer release is published on
// GitHub, a small "Update vX.Y.Z" link appears above the version, and a
// dismissable toast announces it once. Clicking either asks to confirm, then
// POSTs /api/update/apply — which syncs the fork with upstream so the host
// redeploys on its own (see README → Updating). If one-click update isn't
// configured, it falls back to pointing at the release + manual sync.

interface UpdateInfo {
  current: string
  latest?: string
  updateAvailable: boolean
  releaseUrl?: string
  releaseName?: string
}

// One request per page load no matter how many badges are mounted, and one
// toast per page load no matter how many badges see the result.
let checkPromise: Promise<UpdateInfo | null> | null = null
let announced = false

// Test hook (mirrors ?tour=): visiting any page with `?test-update=0.1.0`
// pretends the running build is that version, so the whole notice → toast →
// confirm → apply chain can be exercised against real GitHub release data.
function testVersionFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('test-update')
  return v && /^\d+\.\d+\.\d+$/.test(v) ? v : null
}

function fetchUpdateInfo(): Promise<UpdateInfo | null> {
  const test = testVersionFromUrl()
  const url = test ? `/api/update/check?as=${test}` : '/api/update/check'
  if (test) {
    // Don't cache test lookups into the normal path.
    return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  }
  checkPromise ??= fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return checkPromise
}

const DISMISS_KEY = 'spite_update_dismissed'

async function applyUpdate(info: UpdateInfo) {
  const ok = window.confirm(
    `Update SPITE v${info.current} → v${info.latest}?\n\n` +
      'This merges the latest release into your GitHub repo; your host then ' +
      'redeploys automatically. Takes a couple of minutes — nothing else to do.',
  )
  if (!ok) return
  const id = toast.loading('Updating — syncing your repo with the latest release…')
  try {
    const res = await fetch('/api/update/apply', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success('Update started. Your host is redeploying — refresh in a couple of minutes.', { id, duration: 12000 })
    } else if (res.status === 501) {
      toast.info(data.error || 'One-click update is not configured — sync your fork on GitHub.', { id, duration: 15000 })
      if (info.releaseUrl) window.open(info.releaseUrl, '_blank', 'noopener')
    } else {
      toast.error(data.error || 'Update failed — sync your fork on GitHub instead.', { id, duration: 15000 })
    }
  } catch {
    toast.error('Could not reach the update endpoint — try again.', { id })
  }
}

function useUpdateInfo(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchUpdateInfo().then((data) => {
      if (cancelled || !data?.updateAvailable || !data.latest) return
      setInfo(data)
      // Announce once per page load, unless this version was dismissed.
      // Test mode ignores dismissal so the toast can always be re-triggered.
      const dismissed =
        !testVersionFromUrl() &&
        typeof window !== 'undefined' &&
        window.localStorage.getItem(DISMISS_KEY) === data.latest
      if (!announced && !dismissed) {
        announced = true
        toast(`SPITE v${data.latest} is available`, {
          description: 'Update now? Your host redeploys automatically.',
          duration: 20000,
          action: { label: 'Update', onClick: () => applyUpdate(data) },
          cancel: {
            label: 'Later',
            onClick: () => window.localStorage.setItem(DISMISS_KEY, data.latest!),
          },
        })
      }
    })
    return () => { cancelled = true }
  }, [])
  return info
}

export function VersionBadge({ className = '' }: { className?: string }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  const stamp = process.env.NEXT_PUBLIC_BUILD_STAMP || ''
  const sha = (process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)
  const update = useUpdateInfo()

  return (
    <span className={`flex flex-col items-end leading-tight ${className}`}>
      {update?.updateAvailable && (
        <button
          onClick={() => applyUpdate(update)}
          title={`${update.releaseName || `v${update.latest}`} is available — click to update`}
          className="select-none text-[9px] font-mono text-accent/80 hover:text-accent transition-colors whitespace-nowrap"
        >
          Update v{update.latest} ↑
        </button>
      )}
      <span
        title={`v${version}${stamp ? ` · built ${stamp} UTC` : ''} · ${sha}`}
        className="select-none text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors whitespace-nowrap"
      >
        v{version}
        {stamp && <span className="hidden sm:inline"> · {stamp}</span>}
      </span>
    </span>
  )
}
