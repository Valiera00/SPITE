import {
  checkRequiredEnv,
  ENV_VAR_HINTS,
  ENV_GROUPS,
  storageTarget,
} from '@/lib/env-check'

// Server component: re-evaluates env vars on every request, so as soon
// as the missing variables are filled in (and the server is restarted
// or redeployed) the user gets bounced past this page automatically.
export const dynamic = 'force-dynamic'

const ICE = '#6B8FA8'
const OFF_WHITE = '#F0EDE6'
const BG = '#07090b'
const MONO = 'ui-monospace, Menlo, Consolas, monospace'

export default function SetupPage() {
  const { missing } = checkRequiredEnv()
  const missingSet = new Set<string>(missing)
  const storage = storageTarget()

  // Group-level progress. Four short errands reads far better than seven
  // loose variable names to someone who has never seen an env file.
  const groups = ENV_GROUPS.map((g) => {
    const absent = g.vars.filter((v) => missingSet.has(v))
    return { ...g, absent, done: absent.length === 0 }
  })
  const doneCount = groups.filter((g) => g.done).length
  const allDone = missing.length === 0
  const currentIndex = groups.findIndex((g) => !g.done)

  return (
    <div className="spite-ozone-bg relative flex items-center justify-center min-h-screen overflow-hidden">
      <div className="spite-grain" aria-hidden="true" />

      <div className="relative z-10 flex flex-col items-center gap-10 w-full max-w-xl px-6 py-16">
        <img
          src="/brand/icon-text/SPITE_text+icon_FLAT_WHITE.svg"
          alt="SPITE"
          className="h-12 w-auto select-none"
          draggable={false}
        />

        {/* heading + progress */}
        <div className="w-full flex flex-col items-center">
          <h1
            className="text-2xl tracking-tight text-center"
            style={{ fontFamily: 'var(--font-montserrat)', color: OFF_WHITE }}
          >
            {allDone ? 'Ready to go' : `Connect ${groups.length === 4 ? 'four' : groups.length} things`}
          </h1>
          <p
            className="text-sm text-center mt-2.5 leading-relaxed"
            style={{ color: 'rgba(240,237,230,0.62)', maxWidth: '46ch' }}
          >
            {allDone
              ? 'Everything is connected. If you just added these values, restart the server (or redeploy) so they take effect.'
              : 'SPITE runs on your own accounts, so it needs a few connections before it will start. Grab each value and paste it into your environment.'}
          </p>

          {allDone && (
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 mt-7 rounded-xl w-full"
              style={{
                padding: '15px 22px',
                background: `linear-gradient(120deg, #cfe4f2, ${ICE})`,
                color: '#07121b',
                fontFamily: 'var(--font-montserrat)',
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: '-0.01em',
                boxShadow: '0 10px 34px rgba(107,143,168,0.28)',
              }}
            >
              Open SPITE
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h15m0 0-6-6m6 6-6 6" />
              </svg>
            </a>
          )}

          <div className="w-full mt-6" aria-hidden="true">
            <div
              style={{
                height: 3,
                width: '100%',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.07)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${(doneCount / groups.length) * 100}%`,
                  background: ICE,
                  borderRadius: 99,
                  transition: 'width .4s ease',
                }}
              />
            </div>
            <span
              className="block mt-2 text-[10px] uppercase"
              style={{ fontFamily: MONO, letterSpacing: '0.2em', color: 'rgba(240,237,230,0.45)' }}
            >
              {doneCount} of {groups.length} connected
            </span>
          </div>
        </div>

        {/* the chain — each connection is a node on a thread */}
        <ol className="relative w-full list-none m-0 flex flex-col gap-3.5" style={{ paddingLeft: 46 }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 15,
              top: 20,
              bottom: 20,
              width: 1,
              background: `linear-gradient(180deg, ${ICE}, rgba(107,143,168,0.14))`,
            }}
          />

          {groups.map((g, i) => {
            const isCurrent = i === currentIndex
            return (
              <li
                key={g.title}
                className="relative rounded-2xl"
                style={{
                  padding: '18px 20px',
                  border: `1px solid ${g.done ? 'rgba(107,143,168,0.28)' : 'rgba(255,255,255,0.08)'}`,
                  background: g.done
                    ? 'linear-gradient(180deg, rgba(107,143,168,0.09), rgba(9,12,15,0.35))'
                    : 'linear-gradient(180deg, rgba(18,24,30,0.55), rgba(9,12,15,0.4))',
                  backdropFilter: 'blur(16px) saturate(140%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                }}
              >
                {/* the node on the thread */}
                <span
                  aria-hidden="true"
                  className="absolute flex items-center justify-center rounded-full"
                  style={{
                    left: -46,
                    top: 20,
                    width: 31,
                    height: 31,
                    background: BG,
                    fontFamily: MONO,
                    fontSize: 11,
                    border: `1px solid ${
                      g.done ? ICE : isCurrent ? 'rgba(240,237,230,0.5)' : 'rgba(255,255,255,0.08)'
                    }`,
                    color: g.done ? ICE : isCurrent ? OFF_WHITE : 'rgba(240,237,230,0.5)',
                    boxShadow: g.done
                      ? `0 0 0 4px rgba(107,143,168,0.10), 0 0 18px rgba(107,143,168,0.35)`
                      : 'none',
                  }}
                >
                  {g.done ? '✓' : String(i + 1).padStart(2, '0')}
                </span>

                <div className="flex items-baseline justify-between gap-3.5">
                  <span
                    className="text-[14.5px]"
                    style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 500, color: OFF_WHITE }}
                  >
                    {g.title}
                  </span>
                  <span
                    className="text-[9.5px] uppercase shrink-0"
                    style={{
                      fontFamily: MONO,
                      letterSpacing: '0.16em',
                      color: g.done ? ICE : 'rgba(240,237,230,0.38)',
                    }}
                  >
                    {g.done ? 'connected' : `${g.absent.length} missing`}
                  </span>
                </div>

                <p
                  className="mt-2 text-[12.5px] leading-relaxed"
                  style={{ fontWeight: 300, color: 'rgba(240,237,230,0.6)' }}
                >
                  {g.blurb}
                  {/* Name the store actually in use. Showing both this and the
                      Cloudflare link would read as "so which is it?" — the exact
                      confusion this line exists to prevent. */}
                  {g.title === 'Storage' && storage.custom && (
                    <span style={{ color: 'rgba(240,237,230,0.4)' }}>
                      {' '}Using <span style={{ fontFamily: MONO, color: ICE }}>{storage.label}</span>
                    </span>
                  )}
                </p>

                {g.absent.length > 0 && (
                  <div
                    className="mt-3.5 pt-3.5 flex flex-col gap-2.5"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    {g.absent.map((key) => (
                      <div key={key}>
                        <code style={{ fontFamily: MONO, fontSize: 12.5, color: ICE }}>{key}</code>
                        <span
                          className="block mt-0.5 text-[11.5px] leading-relaxed"
                          style={{ fontWeight: 300, color: 'rgba(240,237,230,0.55)' }}
                        >
                          {ENV_VAR_HINTS[key]}
                        </span>
                      </div>
                    ))}

                    {/* Only on steps you still have to act on — a finished step
                        doesn't need to send you anywhere. Opens in a new tab so
                        nobody loses this page mid-setup. */}
                    {g.linkUrl && !(g.title === 'Storage' && storage.custom) && (
                      <a
                        href={g.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center self-start gap-1.5 mt-1.5 rounded-lg"
                        style={{
                          padding: '7px 13px',
                          border: `1px solid rgba(107,143,168,0.35)`,
                          background: 'rgba(107,143,168,0.09)',
                          color: ICE,
                          fontSize: 11.5,
                          fontWeight: 500,
                          letterSpacing: '0.01em',
                        }}
                      >
                        Open {g.linkLabel}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M7 17 17 7M9 7h8v8" />
                        </svg>
                      </a>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        {/* where the values go */}
        <div
          className="w-full flex flex-col gap-2 text-[11.5px] leading-relaxed"
          style={{ fontWeight: 300, color: 'rgba(240,237,230,0.45)' }}
        >
          <p className="m-0">
            <span style={{ fontFamily: MONO, color: 'rgba(240,237,230,0.75)' }}>Local dev:</span>{' '}
            copy <span style={{ fontFamily: MONO }}>.env.example</span> to{' '}
            <span style={{ fontFamily: MONO }}>.env.local</span>, fill in the values, then restart{' '}
            <span style={{ fontFamily: MONO }}>pnpm dev</span>.
          </p>
          <p className="m-0">
            <span style={{ fontFamily: MONO, color: 'rgba(240,237,230,0.75)' }}>Vercel:</span>{' '}
            Settings → Environment Variables, add each name, then redeploy. Values only take effect
            on a fresh build.
          </p>
        </div>

        <p
          className="text-[9.5px] text-center uppercase select-none"
          style={{ fontFamily: MONO, letterSpacing: '0.22em', color: 'rgba(240,237,230,0.28)' }}
        >
          Built out of spite. Made for control.
        </p>
      </div>
    </div>
  )
}
