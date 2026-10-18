import { NextRequest, NextResponse } from 'next/server'
import { FAMILIES, getChoices, setChoice, type Family } from '@/lib/model-routing'
import { estimateGenerationCost } from '@/lib/fal-cost'
import { getModelById } from '@/lib/fal-models'

// 1080p price per second on fal and direct, for Settings to compare. Silent
// 1-second render, so it is the plain rate with nothing added.
function perSecond(modelId: string, provider: Parameters<typeof estimateGenerationCost>[1]['provider']) {
  const model = getModelById(modelId)
  const e = estimateGenerationCost(model, { count: 1, durationSeconds: 1, resolution: '1080p', audio: false, provider })
  return e.isKnown && e.provider === (provider || 'fal') ? e.perUnit : null
}

async function describe() {
  const choices = await getChoices()
  return {
    families: (Object.keys(FAMILIES) as Family[]).map((id) => {
      const { label, models, provider } = FAMILIES[id]
      return {
        id,
        label,
        choice: choices[id],
        provider: provider.label,
        configured: provider.configured(),
        envVars: provider.envVars,
        pricing: provider.pricingId(),
        prices: models.map((m) => ({
          model: getModelById(m)?.name || m,
          fal: perSecond(m, 'fal'),
          direct: perSecond(m, provider.pricingId()),
        })),
      }
    }),
  }
}

export async function GET() {
  return NextResponse.json(await describe(), { headers: { 'Cache-Control': 'no-store' } })
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
    return NextResponse.json(await describe())
  } catch (error) {
    console.error('[settings/providers] save error:', error)
    return NextResponse.json({ error: 'Failed to save provider choice' }, { status: 500 })
  }
}
