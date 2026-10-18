import { NextRequest, NextResponse } from 'next/server'
import { FAMILIES, setChoice, type Family } from '@/lib/model-routing'
import { describeProviders } from '@/lib/provider-settings'

export async function GET() {
  return NextResponse.json(await describeProviders(), { headers: { 'Cache-Control': 'no-store' } })
}

// Save one family's choice from Settings → Model providers.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const family = body?.family
    const choice = body?.choice
    if (!(typeof family === 'string' && family in FAMILIES) || (choice !== 'fal' && choice !== 'direct')) {
      return NextResponse.json({ error: 'Unknown model family or provider.' }, { status: 400 })
    }
    await setChoice(family as Family, choice)
    return NextResponse.json(await describeProviders())
  } catch (error) {
    console.error('[settings/providers] save error:', error)
    return NextResponse.json({ error: 'Failed to save provider choice' }, { status: 500 })
  }
}
