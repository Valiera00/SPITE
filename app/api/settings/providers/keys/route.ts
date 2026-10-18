import { NextRequest, NextResponse } from 'next/server'
import { describeSetting, invalidValue, isSettingName, saveSetting } from '@/lib/provider-secrets'
import { describeProviders } from '@/lib/provider-settings'

// Where one setting comes from (Settings, environment, or nowhere) and the
// last four characters of a key. Never the value itself.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')
  if (!isSettingName(name)) return NextResponse.json({ error: 'Unknown setting.' }, { status: 400 })
  return NextResponse.json({ setting: await describeSetting(name) }, { headers: { 'Cache-Control': 'no-store' } })
}

// Save or remove one setting (an API key, Alibaba's workspace id or region)
// from Settings. Stored encrypted; the response never contains the value.
// Never log the request body.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = body?.name
    if (!isSettingName(name)) {
      return NextResponse.json({ error: 'Unknown setting.' }, { status: 400 })
    }
    if (body?.value === null) {
      await saveSetting(name, null)
    } else {
      const value = typeof body?.value === 'string' ? body.value.trim() : ''
      const bad = invalidValue(name, value)
      if (bad) return NextResponse.json({ error: bad }, { status: 400 })
      await saveSetting(name, value)
    }
    return NextResponse.json({ setting: await describeSetting(name), ...(await describeProviders()) })
  } catch (error) {
    console.error('[settings/providers/keys] save error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
