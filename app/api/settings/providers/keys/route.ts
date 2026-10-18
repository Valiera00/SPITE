import { NextRequest, NextResponse } from 'next/server'
import { invalidValue, isSettingName, saveSetting } from '@/lib/provider-secrets'
import { describeProviders } from '@/lib/provider-settings'

// Save or remove one provider setting (an API key, Alibaba's workspace id or
// region) from Settings → Model providers. Stored encrypted; the response
// never contains the value. Never log the request body.
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
    return NextResponse.json(await describeProviders())
  } catch (error) {
    console.error('[settings/providers/keys] save error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
