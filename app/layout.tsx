import type { Metadata } from 'next'
import { DM_Serif_Display, Geist_Mono } from 'next/font/google'
import { AuthProvider } from '@/components/auth-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-serif',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'FRAME — AI Filmmaking Canvas',
  description: 'A professional AI filmmaking canvas for the solo filmmaker.',
  generator: 'v0.app',
}

// Suppress ResizeObserver errors (common with React Flow)
if (typeof window !== 'undefined') {
  const resizeObserverErr = window.onerror
  window.onerror = (msg, ...args) => {
    if (typeof msg === 'string' && msg.includes('ResizeObserver')) return true
    return resizeObserverErr ? resizeObserverErr(msg, ...args) : false
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${dmSerifDisplay.variable} ${geistMono.variable} bg-background`} suppressHydrationWarning>
      <body className="font-mono antialiased bg-background text-foreground min-h-screen" suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  )
}
