'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function verifyPassword(password: string) {
  const correctPassword = process.env.APP_PASSWORD?.trim()

  if (!correctPassword) {
    return { success: false }
  }

  if (password.trim() === correctPassword) {
    // Set httpOnly cookie that expires in 30 days
    const cookieStore = await cookies()
    cookieStore.set('frame_session', 'authenticated', {
      httpOnly: true,
      secure: false, // Allow in development
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
      path: '/',
    })
    return { success: true }
  }

  return { success: false }
}

export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete('frame_session')
  redirect('/login')
}
