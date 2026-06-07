'use client'

import { useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { version as appVersion } from '@/package.json'

// Vercel injects the commit SHA at build time via next.config; local
// dev falls back to "dev". Shown faintly in the bottom-right so I
// always know which build I'm looking at without opening DevTools.
const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev'
const shortSha = commitSha === 'dev' ? 'dev' : commitSha.slice(0, 7)

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [shake, setShake] = useState(false)
  const { login, isLoading: authLoading } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const success = await login(password)
    if (!success) {
      setError('Incorrect password')
      setShake(true)
      setTimeout(() => setShake(false), 600)
    }
    setIsLoading(false)
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#050608' }}>
        <div className="text-muted-foreground/40 font-mono text-xs tracking-wider">Loading…</div>
      </div>
    )
  }

  const buttonDisabled = isLoading || !password

  return (
    <div
      className="relative flex items-center justify-center min-h-screen overflow-hidden"
      style={{
        // Ozone-layer base: deep near-black ground with a faint frost-blue
        // curve glowing up from the bottom edge. Radial ellipse sits below
        // the viewport so only the top of the arc is visible — gives the
        // horizon feel without competing with the wordmark.
        background:
          'radial-gradient(ellipse 80% 55% at 50% 112%, rgba(107, 143, 168, 0.22) 0%, rgba(107, 143, 168, 0.06) 35%, transparent 70%), #050608',
      }}
    >
      {/* Film grain overlay — brand guide §18: fine grain in the
          surrounding system, never on the wordmark. */}
      <div className="spite-grain" aria-hidden="true" />

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-14 w-full max-w-sm px-6">
        <img
          src="/brand/icon-text/SPITE_text+icon_FLAT_WHITE.svg"
          alt="SPITE"
          className="h-20 w-auto select-none"
          draggable={false}
        />

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
          <div className="relative">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              disabled={isLoading}
              className={`w-full px-4 py-3 text-sm rounded-lg transition-all duration-200 focus:outline-none ${shake ? 'animate-shake' : ''}`}
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'rgba(255, 255, 255, 0.035)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#F0EDE6',
                backdropFilter: 'blur(16px) saturate(140%)',
                WebkitBackdropFilter: 'blur(16px) saturate(140%)',
              }}
            />
          </div>

          {error && (
            <p className="text-[11px] font-mono text-center animate-in fade-in duration-200 tracking-wider" style={{ color: '#C03030' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={buttonDisabled}
            className="group relative px-6 py-3 rounded-lg text-sm transition-all duration-300 active:scale-[0.98] focus:outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              // Liquid glass: translucent frost blue tint + real backdrop
              // blur + frost blue border + soft inset highlight.
              background: 'rgba(107, 143, 168, 0.18)',
              border: '1px solid rgba(107, 143, 168, 0.45)',
              color: '#F0EDE6',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              opacity: buttonDisabled ? 0.45 : 1,
              cursor: buttonDisabled ? 'not-allowed' : 'pointer',
              // Slow cold-blue breath while idle — anticipation, never
              // urgency. Disabled while submitting so the spinner reads
              // as the active signal.
              animation: isLoading ? 'none' : 'spite-anticipation 3s ease-in-out infinite',
            }}
          >
            {isLoading ? 'UNLOCKING…' : 'UNLOCK'}
          </button>
        </form>

        {/* Tagline — brand guide §09 primary. Uppercased + wide
            tracking for editorial weight, very low contrast so it
            doesn't compete with the form. */}
        <p className="text-[10px] text-muted-foreground/35 text-center font-mono tracking-[0.22em] uppercase select-none">
          Built out of spite. Made for control.
        </p>
      </div>

      {/* Version corner — package.json version + short commit SHA,
          auto-updating on every Vercel deploy. Faint enough to ignore,
          present enough to settle "which build is live" instantly. */}
      <div className="absolute bottom-4 right-5 z-10 text-[10px] font-mono text-muted-foreground/25 tracking-wider select-none">
        v{appVersion} · {shortSha}
      </div>
    </div>
  )
}
