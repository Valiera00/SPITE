import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_DAYS,
  createSession,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  safeStringEquals,
  getClientIp,
} from '@/lib/sessions'

export async function POST(request: Request) {
  const ip = getClientIp(request.headers)

  // Rate gate — first, before any password handling. The owner gets
  // 5 attempts per minute; everything else returns 429 with a
  // Retry-After hint.
  const rateLimit = await checkLoginRateLimit(ip)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Try again in a minute.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    )
  }

  let body: { password?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    // Don't leak that the JSON was malformed vs missing.
    return NextResponse.json({ success: false }, { status: 400 })
  }
  const submittedPassword = typeof body.password === 'string' ? body.password.trim() : ''
  const correctPassword = process.env.APP_PASSWORD?.trim() ?? ''

  // No password configured: refuse-to-boot is handled by middleware via
  // the /setup page, so reaching here without an APP_PASSWORD means the
  // env config check was bypassed somehow. Return a generic 401, not a
  // 500 that fingerprints "not configured" to unauth callers.
  if (!correctPassword) {
    return NextResponse.json({ success: false }, { status: 401 })
  }

  // Constant-time comparison so attempt timing can't be used as a
  // side channel to recover the password byte by byte.
  const match = safeStringEquals(submittedPassword, correctPassword)
  if (!match) {
    await recordFailedLogin(ip)
    return NextResponse.json({ success: false }, { status: 401 })
  }

  // Success path: mint a session, drop the cookie, clear this IP's
  // attempt log so the rate limit doesn't punish a slow typist.
  const token = await createSession()
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
    path: '/',
  })
  await clearLoginAttempts(ip)
  return NextResponse.json({ success: true })
}
