import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRequiredEnv } from '@/lib/env-check'

// Paths that must stay reachable without a login cookie.
// - /login: the login page itself
// - /setup: shown when required env vars are missing
// - /api/auth/verify + /api/auth/logout: the login/logout endpoints
// - /api/assets/cleanup: scheduled cleanup job, auth via CRON_SECRET
// - /api/r2-image: media proxy, does its own cookie-or-signed-token check
const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/api/auth/verify',
  '/api/auth/logout',
  '/api/assets/cleanup',
  '/api/r2-image',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // First gate: refuse to boot if required env vars are missing. Sends
  // every request to /setup until the install is configured, so a
  // self-hoster sees clear instructions instead of a broken-looking
  // login screen. The /setup page itself, and Next.js static asset
  // requests, are allowed through so the page can render.
  const envCheck = checkRequiredEnv()
  if (!envCheck.ok) {
    if (pathname === '/setup' || pathname.startsWith('/_next/')) {
      return NextResponse.next()
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Setup required', missing: envCheck.missing },
        { status: 503 },
      )
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  // Second gate: standard cookie-based auth.
  const isAuthenticated =
    request.cookies.get('spite_session')?.value === 'authenticated'

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )

  if (isAuthenticated) {
    // Already logged in: bounce away from the login/setup pages.
    if (pathname === '/login' || pathname === '/setup') {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  // Not logged in:
  if (isPublic) {
    return NextResponse.next()
  }

  // Block API routes with a clear 401 (no HTML redirect for data calls).
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Block pages by sending them to the login screen.
  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static asset files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)',
  ],
}
