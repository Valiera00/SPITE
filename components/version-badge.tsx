'use client'

// Faint "which build am I on?" marker. Shows the app version plus a build stamp
// (e.g. `v0.2.0 · 30 Jul 21:47`) rather than the commit SHA: a hash is random to
// read, so it can't answer "did my refresh pick up the new build?" at a glance,
// while an ordered timestamp can. Hover for the exact commit.
export function VersionBadge({ className = '' }: { className?: string }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  const stamp = process.env.NEXT_PUBLIC_BUILD_STAMP || ''
  const sha = (process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)

  return (
    <span
      title={`v${version}${stamp ? ` · built ${stamp} UTC` : ''} · ${sha}`}
      className={`select-none text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors whitespace-nowrap ${className}`}
    >
      v{version}
      {stamp && <span className="hidden sm:inline"> · {stamp}</span>}
    </span>
  )
}
