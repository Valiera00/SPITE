import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, revokeSession } from '@/lib/sessions'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  // Revoke server-side first so the cookie value is dead even if the
  // client never receives the cleared cookie (e.g. dropped response).
  await revokeSession(token)
  cookieStore.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ success: true })
}
