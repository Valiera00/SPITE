'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  // Check auth status on mount by asking the server whether the
  // httpOnly session cookie is valid.
  useEffect(() => {
    let active = true
    fetch('/api/auth/check')
      .then((res) => res.ok)
      .then((ok) => {
        if (active) {
          setIsAuthenticated(ok)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setIsAuthenticated(false)
          setIsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  // Once authenticated, leave the login page. (Blocking unauthenticated
  // access is handled server-side by middleware, so we don't redirect here.)
  useEffect(() => {
    if (isLoading) return
    if (pathname === '/login' && isAuthenticated) {
      router.push('/')
    }
  }, [isAuthenticated, isLoading, pathname, router])

  const login = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()

      if (data.success) {
        setIsAuthenticated(true)
        router.push('/')
        router.refresh()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // ignore network errors — we still clear local state and redirect
    }
    setIsAuthenticated(false)
    router.push('/login')
    router.refresh()
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
