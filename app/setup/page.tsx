import { checkRequiredEnv, ENV_VAR_HINTS } from '@/lib/env-check'

// Server component: re-evaluates env vars on every request, so as soon
// as the missing variables are filled in (and the server is restarted
// or redeployed) the user gets bounced past this page automatically.
export const dynamic = 'force-dynamic'

export default function SetupPage() {
  const { missing } = checkRequiredEnv()

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
          <div className="flex flex-col gap-2 text-center">
            <h1
              className="text-2xl tracking-tight"
              style={{ fontFamily: 'var(--font-montserrat)', color: '#F0EDE6' }}
            >
              Setup required
            </h1>
            <p className="text-sm text-muted-foreground/70">
              SPITE refuses to boot until the environment is configured. Fill in
              the missing values below and restart.
            </p>
          </div>

          {missing.length > 0 ? (
            <div
              className="w-full rounded-lg p-5 flex flex-col gap-3"
              style={{
                background: 'rgba(255, 255, 255, 0.035)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(16px) saturate(140%)',
                WebkitBackdropFilter: 'blur(16px) saturate(140%)',
              }}
            >
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                Missing
              </p>
              <ul className="flex flex-col gap-3">
                {missing.map((key) => (
                  <li key={key} className="flex flex-col gap-1">
                    <code
                      className="text-sm font-mono"
                      style={{ color: '#6B8FA8' }}
                    >
                      {key}
                    </code>
                    <span className="text-xs text-muted-foreground/70 leading-relaxed">
                      {ENV_VAR_HINTS[key]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              className="w-full rounded-lg p-5 text-sm text-center text-muted-foreground/70"
              style={{
                background: 'rgba(107, 143, 168, 0.08)',
                border: '1px solid rgba(107, 143, 168, 0.25)',
              }}
            >
              Configuration looks complete. If you&apos;re still seeing this
              page, restart the server so the new values are picked up.
            </div>
          )}

          <div className="flex flex-col gap-3 text-xs text-muted-foreground/60 leading-relaxed">
            <p>
              <span className="font-mono text-foreground/80">Local dev:</span>{' '}
              copy <code className="font-mono">.env.example</code> to{' '}
              <code className="font-mono">.env.local</code>, fill in the
              values, then stop and restart{' '}
              <code className="font-mono">pnpm dev</code>.
            </p>
            <p>
              <span className="font-mono text-foreground/80">Vercel:</span>{' '}
              Settings → Environment Variables, add each name + value, then
              redeploy. Variables only take effect on a fresh build.
            </p>
            <p>
              Full setup walkthrough is in{' '}
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
