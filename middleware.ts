import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRequiredEnv } from '@/lib/env-check'
import { SESSION_COOKIE_NAME, isSessionValid } from '@/lib/sessions'

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

export async function middleware(request: NextRequest) {
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

  // Second gate: validate the session token against the sessions table.
  // The cookie value is now a random 256-bit token, not a static
  // string, so a captured cookie can be invalidated server-side by
  // logout / expiry.
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const isAuthenticated = await isSessionValid(token)

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
    // The image-extension exemption is anchored to `$` — paths like
    // `/api/r2-image/foo.png/extra` still go through middleware because
    // they don't END in an image extension. Without the anchor, any
    // route containing `.png` (or .svg, .jpg, etc.) anywhere in its
    // path would silently skip authz.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
