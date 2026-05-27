import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    const correctPassword = process.env.APP_PASSWORD?.trim()

    if (!correctPassword) {
      return NextResponse.json({ success: false, error: 'No password configured' }, { status: 500 })
    }

    if (password?.trim() === correctPassword) {
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false })
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
