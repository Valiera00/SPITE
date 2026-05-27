import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both passwords are required' }, { status: 400 })
    }

    // Verify current password
    const correctPassword = process.env.APP_PASSWORD?.trim()
    if (!correctPassword || currentPassword !== correctPassword) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
    }

    // Note: In a real production app, you would update the Vercel environment variable
    // via the Vercel API. For now, we return instructions since env vars can't be 
    // directly modified at runtime.
    
    // This is a placeholder - in production, integrate with Vercel's API:
    // https://vercel.com/docs/rest-api/endpoints/projects#create-one-or-more-environment-variables
    
    return NextResponse.json({ 
      success: true,
      message: 'Password verification successful. To change the password, update APP_PASSWORD in your Vercel environment variables and redeploy.'
    })
  } catch (error) {
    console.error('[password] Change error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
