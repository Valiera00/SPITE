'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { ArrowSquareOut, Bell, X } from '@phosphor-icons/react'

// Faint "which build am I on?" marker. Shows the app version plus a build stamp
// (e.g. `v0.2.0 · 30 Jul 21:47`) rather than the commit SHA: a hash is random to
// read, so it can't answer "did my refresh pick up the new build?" at a glance,
// while an ordered timestamp can. Hover for the exact commit.
//
// It also doubles as the update notice: when a newer release is published on
// GitHub, a small "Update vX.Y.Z" link appears above the version, and a
// dismissable toast announces it once. Clicking either opens a "What's new"
// dialog with the release notes; confirming there POSTs /api/update/apply,
// which syncs the fork with upstream so the host redeploys on its own (see
// README → Updating). If one-click update isn't configured, it falls back to
// pointing at the release + manual sync.

interface UpdateInfo {
  current: string
  latest?: string
  updateAvailable: boolean
  releaseUrl?: string
  releaseName?: string
  publishedAt?: string | null
  notes?: string
}

// One request per page load no matter how many badges are mounted, and one
// toast per page load no matter how many badges see the result.
let checkPromise: Promise<UpdateInfo | null> | null = null
let announced = false

// Test hook (mirrors ?tour=): visiting any page with `?test-update=0.1.0`
// pretends the running build is that version, so the whole notice → toast →
// dialog → apply chain can be exercised against real GitHub release data.
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

// The dialog is the confirmation step, so no extra window.confirm here.
async function applyUpdate(info: UpdateInfo) {
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

// Strip the heaviest markdown so release notes read cleanly as text without
// pulling in a renderer: headings/bold/links keep their text, bullets stay.
function plainNotes(md: string): string {
  return md
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\r/g, '')
    .trim()
}

function WhatsNewDialog({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const date = info.publishedAt
    ? new Date(info.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative glass rounded-2xl border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] w-full max-w-md p-5 flex flex-col gap-3 text-[#F0EDE6]"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition"><X size={14} /></button>

        <div className="pr-6">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-accent/80">What&apos;s new</p>
          <h3 className="text-lg font-semibold tracking-tight mt-0.5" style={{ fontFamily: 'var(--font-montserrat)' }}>
            {info.releaseName || `v${info.latest}`}
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
            you&apos;re on v{info.current}{date ? ` · released ${date}` : ''}
          </p>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-xl bg-black/25 border border-white/[0.06] px-3.5 py-3">
          <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80 font-sans">
            {info.notes ? plainNotes(info.notes) : 'No release notes provided — see the release on GitHub.'}
          </pre>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          {info.releaseUrl && (
            <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 h-8 rounded-full bg-white/[0.06] hover:bg-white/10 text-[11px] font-mono text-foreground/80 transition"><ArrowSquareOut size={12} /> GitHub</a>
          )}
          <button
            onClick={() => { onClose(); applyUpdate(info) }}
            className="ml-auto px-4 h-8 rounded-full bg-accent text-[#0D0F12] text-[11px] font-mono font-medium active:scale-95 transition"
          >
            Update now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function useUpdateInfo(onOpenNotes: (info: UpdateInfo) => void): UpdateInfo | null {
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
          description: 'See what’s new and update in one click.',
          duration: 20000,
          action: { label: 'What’s new', onClick: () => onOpenNotes(data) },
          cancel: {
            label: 'Later',
            onClick: () => window.localStorage.setItem(DISMISS_KEY, data.latest!),
          },
        })
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return info
}

// ---------------------------------------------------------------------------
// Notifications. Things that happen with no browser open — the nightly
// cleanup's "Deleted 3 assets from Project X", a version change — are logged
// server-side (lib/events.ts). On the next page load the unseen ones are
// toasted once, and the bell keeps the full history so they can be found
// again later. Lives next to the version so update notices and deletion
// notices share one place.

interface AppEvent {
  id: number
  kind: string
  title: string
  created_at: string
  seen: boolean
}

// One request per page load no matter how many badges are mounted.
let eventsPromise: Promise<{ events: AppEvent[]; unseen: number } | null> | null = null
let eventsAnnounced = false

function fetchEvents() {
  eventsPromise ??= (async () => {
    // Report the running build first, so an update that just landed is
    // already in the list we fetch next.
    await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'version', version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0' }),
    }).catch(() => null)
    const r = await fetch('/api/events').catch(() => null)
    return r && r.ok ? (r.json() as Promise<{ events: AppEvent[]; unseen: number }>) : null
  })()
  return eventsPromise
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)} h ago`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)} d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function NotificationsBell() {
  const [data, setData] = useState<{ events: AppEvent[]; unseen: number } | null>(null)
  // Dot on the bell until the list is opened once this page load.
  const [fresh, setFresh] = useState(0)
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchEvents().then((d) => {
      if (cancelled || !d) return
      setData(d)
      setFresh(d.unseen)
      if (!eventsAnnounced && d.unseen > 0) {
        eventsAnnounced = true
        const unseen = d.events.filter((e) => !e.seen).slice(0, 5)
        for (const e of unseen) {
          toast(e.title, {
            description: `${e.kind === 'cleanup' ? 'Auto-delete' : e.kind === 'update' ? 'Update' : 'Notice'} · ${timeAgo(e.created_at)}`,
            duration: 12000,
          })
        }
        if (d.unseen > unseen.length) toast(`${d.unseen - unseen.length} more in notifications`, { duration: 8000 })
        fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seen' }),
        }).catch(() => null)
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = () => {
    setFresh(0)
    if (open) { setOpen(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Portal + fixed position, so a toolbar's overflow can't clip the list.
    setOpen({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }

  const events = data?.events ?? []
  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Notifications"
        title="Notifications — auto-delete runs and updates"
        className="relative flex items-center justify-center w-5 h-5 rounded text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
      >
        <Bell size={11} weight={fresh ? 'fill' : 'regular'} />
        {fresh > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: open.top, right: open.right }}
          className="w-80 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-[#0E1014]/[0.98] shadow-2xl z-[120] py-1 text-left"
          onWheel={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">Notifications</div>
          {events.length === 0 ? (
            <div className="px-3 py-3 text-[11px] leading-relaxed text-muted-foreground/50">
              Nothing yet. Auto-delete runs and SPITE updates will show up here.
            </div>
          ) : (
            events.map((e) => (
              <div key={e.id} className="px-3 py-2 border-t border-white/5">
                <div className={`text-[11px] leading-snug ${e.kind === 'cleanup' ? 'text-rose-200/90' : 'text-foreground/80'}`}>
                  {e.title}
                </div>
                <div className="text-[10px] text-muted-foreground/40">
                  {e.kind === 'cleanup' ? 'Auto-delete' : e.kind === 'update' ? 'Update' : 'Notice'} · {timeAgo(e.created_at)}
                </div>
              </div>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

export function VersionBadge({ className = '' }: { className?: string }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  const stamp = process.env.NEXT_PUBLIC_BUILD_STAMP || ''
  const sha = (process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)
  const [notesFor, setNotesFor] = useState<UpdateInfo | null>(null)
  const update = useUpdateInfo(setNotesFor)

  return (
    <span className={`flex flex-col items-end leading-tight ${className}`}>
      {update?.updateAvailable && (
        <button
          onClick={() => setNotesFor(update)}
          title={`${update.releaseName || `v${update.latest}`} is available — see what's new`}
          className="select-none text-[9px] font-mono text-accent/80 hover:text-accent transition-colors whitespace-nowrap"
        >
          Update v{update.latest} ↑
        </button>
      )}
      <span className="flex items-center gap-1">
        <NotificationsBell />
        <span
          title={`v${version}${stamp ? ` · built ${stamp} UTC` : ''} · ${sha}`}
          className="select-none text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors whitespace-nowrap"
        >
          v{version}
          {stamp && <span className="hidden sm:inline"> · {stamp}</span>}
        </span>
      </span>
      {notesFor && <WhatsNewDialog info={notesFor} onClose={() => setNotesFor(null)} />}
    </span>
  )
}
