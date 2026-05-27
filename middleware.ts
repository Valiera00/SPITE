import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Paths that must stay reachable without a login cookie.
// - /login: the login page itself
// - /api/auth/verify + /api/auth/logout: the login/logout endpoints
// - /api/assets/cleanup: the scheduled cleanup job, which authenticates
//   itself with CRON_SECRET instead of a user session
const PUBLIC_PATHS = ['/login', '/api/auth/verify', '/api/auth/logout', '/api/assets/cleanup']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthenticated = request.cookies.get('frame_session')?.value === 'authenticated'

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )

  if (isAuthenticated) {
    // Already logged in: bounce away from the login page to the dashboard.
    if (pathname === '/login') {
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
