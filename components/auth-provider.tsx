'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  login: (password: string) => Promise<boolean>
  logout: () => void
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

  // Check auth status on mount
  useEffect(() => {
    // TEMPORARILY DISABLED: Auto-authenticate for development
    // TODO: Re-enable password protection once platform is built
    setIsAuthenticated(true)
    setIsLoading(false)

    /* Original code:
    const session = localStorage.getItem('frame_session')
    const expiry = localStorage.getItem('frame_session_expiry')
    
    if (session === 'authenticated' && expiry) {
      const expiryDate = new Date(expiry)
      if (expiryDate > new Date()) {
        setIsAuthenticated(true)
      } else {
        // Session expired
        localStorage.removeItem('frame_session')
        localStorage.removeItem('frame_session_expiry')
      }
    }
    setIsLoading(false)
    */
  }, [])

  // Redirect based on auth status
  useEffect(() => {
    if (isLoading) return
    
    // TEMP: Skip redirect for dev
    if (pathname === '/login' && isAuthenticated) {
      router.push('/')
    }

    /* Original code:
    if (!isAuthenticated && pathname !== '/login') {
      router.push('/login')
    } else if (isAuthenticated && pathname === '/login') {
      router.push('/')
    }
    */
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
        // Set session in localStorage with 30-day expiry
        const expiry = new Date()
        expiry.setDate(expiry.getDate() + 30)
        localStorage.setItem('frame_session', 'authenticated')
        localStorage.setItem('frame_session_expiry', expiry.toISOString())
        setIsAuthenticated(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  const logout = () => {
    localStorage.removeItem('frame_session')
    localStorage.removeItem('frame_session_expiry')
    setIsAuthenticated(false)
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
