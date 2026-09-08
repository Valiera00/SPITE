import { checkRequiredEnv, ENV_VAR_HINTS, ENV_GROUPS } from '@/lib/env-check'

// Server component: re-evaluates env vars on every request, so as soon
// as the missing variables are filled in (and the server is restarted
// or redeployed) the user gets bounced past this page automatically.
export const dynamic = 'force-dynamic'

const ICE = '#6B8FA8'
const OFF_WHITE = '#F0EDE6'

export default function SetupPage() {
  const { missing } = checkRequiredEnv()
  const missingSet = new Set<string>(missing)

  // Group-level progress. Four short errands reads far better than seven
  // loose variable names to someone who has never seen an env file.
  const groups = ENV_GROUPS.map((g) => {
    const absent = g.vars.filter((v) => missingSet.has(v))
    return { ...g, absent, done: absent.length === 0 }
  })
  const doneCount = groups.filter((g) => g.done).length
  const allDone = missing.length === 0

  return (
    <div className="spite-ozone-bg relative flex items-center justify-center min-h-screen overflow-hidden">
      <div className="spite-grain" aria-hidden="true" />

      <div className="relative z-10 flex flex-col items-center gap-10 w-full max-w-xl px-6 py-16">
        <img
          src="/brand/icon-text/SPITE_text+icon_FLAT_WHITE.svg"
          alt="SPITE"
          className="h-14 w-auto select-none"
          draggable={false}
        />

        <div className="w-full flex flex-col gap-8">
          {/* heading + progress */}
          <div className="flex flex-col gap-3 text-center">
            <h1
              className="text-2xl tracking-tight"
              style={{ fontFamily: 'var(--font-montserrat)', color: OFF_WHITE }}
            >
              {allDone ? 'Ready to go' : 'Connect four things'}
            </h1>
            <p className="text-sm text-muted-foreground/70">
              {allDone
                ? 'Everything is configured. Restart the server so the new values are picked up.'
                : 'SPITE runs on your own accounts, so it needs four connections before it will boot. Grab each value and add it to your environment.'}
            </p>

            <div className="flex flex-col gap-2 mt-1" aria-hidden="true">
              <div
                className="h-[3px] w-full rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(doneCount / groups.length) * 100}%`,
                    background: ICE,
                  }}
                />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                {doneCount} of {groups.length} connected
              </span>
            </div>
          </div>

          {/* the four groups */}
          <ol className="w-full flex flex-col gap-3">
            {groups.map((g, i) => (
              <li
                key={g.title}
                className="rounded-lg p-5 flex flex-col gap-3"
                style={{
                  background: g.done
                    ? 'rgba(107, 143, 168, 0.06)'
                    : 'rgba(255, 255, 255, 0.035)',
                  border: `1px solid ${
                    g.done ? 'rgba(107, 143, 168, 0.22)' : 'rgba(255, 255, 255, 0.08)'
                  }`,
                  backdropFilter: 'blur(16px) saturate(140%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="text-sm"
                    style={{ fontFamily: 'var(--font-montserrat)', color: OFF_WHITE }}
                  >
                    <span className="font-mono text-[11px] mr-2" style={{ color: ICE }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {g.title}
                  </span>
                  <span
                    className="text-[10px] font-mono uppercase tracking-[0.16em] shrink-0"
                    style={{ color: g.done ? ICE : 'rgba(240,237,230,0.45)' }}
                  >
                    {g.done ? 'connected' : `${g.absent.length} missing`}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground/70 leading-relaxed">
                  {g.blurb}
                  {g.linkUrl ? (
                    <>
                      {' '}
                      <a
                        href={g.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                        style={{ color: ICE }}
                      >
                        {g.linkLabel}
                      </a>
                    </>
                  ) : (
                    <span className="text-muted-foreground/50"> — {g.linkLabel}</span>
                  )}
                </p>

                {g.absent.length > 0 && (
                  <ul className="flex flex-col gap-2 pt-1">
                    {g.absent.map((key) => (
                      <li key={key} className="flex flex-col gap-1">
                        <code className="text-sm font-mono" style={{ color: ICE }}>
                          {key}
                        </code>
                        <span className="text-xs text-muted-foreground/70 leading-relaxed">
                          {ENV_VAR_HINTS[key]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          {/* where to put the values */}
          <div className="flex flex-col gap-3 text-xs text-muted-foreground/60 leading-relaxed">
            <p>
              <span className="font-mono text-foreground/80">Local dev:</span>{' '}
              copy <code className="font-mono">.env.example</code> to{' '}
              <code className="font-mono">.env.local</code>, fill in the values,
              then stop and restart <code className="font-mono">pnpm dev</code>.
            </p>
            <p>
              <span className="font-mono text-foreground/80">Vercel:</span>{' '}
              Settings → Environment Variables, add each name + value, then
              redeploy. Variables only take effect on a fresh build.
            </p>
            <p>
              Stuck on one of them? The full walkthrough is in{' '}
              <code className="font-mono">README.md</code>.
            </p>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/35 text-center font-mono tracking-[0.22em] uppercase select-none">
          Built out of spite. Made for control.
        </p>
      </div>
    </div>
  )
}
