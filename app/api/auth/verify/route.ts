import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    const correctPassword = process.env.APP_PASSWORD?.trim()

    if (!correctPassword) {
      return NextResponse.json({ success: false, error: 'No password configured' }, { status: 500 })
    }

    if (password?.trim() === correctPassword) {
      const cookieStore = await cookies()
      cookieStore.set('frame_session', 'authenticated', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: '/',
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false })
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
