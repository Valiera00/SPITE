'use client'

import { useState } from 'react'
import { useAuth } from '@/components/auth-provider'

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

  // Show loading while checking auth status
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#080A0C' }}>
        <div className="text-muted-foreground font-mono text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#080A0C' }}>
      <div className="flex flex-col items-center gap-12 w-full max-w-sm px-6">
        {/* Logo */}
        <h1 className="text-6xl tracking-tight font-light" style={{ fontFamily: '"Onnier", serif', color: '#FFFFFF' }}>FRAME</h1>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-6">
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
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#FFFFFF',
                backdropFilter: 'blur(10px)',
              }}
            />
          </div>

          {error && (
            <p className="text-xs font-mono text-center animate-in fade-in duration-200" style={{ color: '#FF6B6B' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 active:scale-95 focus:outline-none"
            style={{
              fontFamily: 'var(--font-mono)',
              backgroundColor: '#4ECDC4',
              color: '#080A0C',
              opacity: isLoading || !password ? 0.5 : 1,
              cursor: isLoading || !password ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>

        {/* Subtle footer */}
        <p className="text-xs text-muted-foreground/30 text-center font-mono">
          AI Filmmaking Canvas
        </p>
      </div>
    </div>
  )
}
