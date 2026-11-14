import { NextRequest, NextResponse } from 'next/server'
import { getModelById } from '@/lib/fal-models'
import { resolveRoute } from '@/lib/model-routing'
import { estimateSeconds } from '@/lib/generation-timings'

// How long a job with these settings usually takes, from this install's own
// history (lib/generation-timings.ts). `known: false` until the model has a
// couple of comparable runs.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const model = getModelById(q.get('modelId') || '')
  if (!model) return NextResponse.json({ error: 'Unknown model' }, { status: 400 })
  const route = await resolveRoute(model.id)
  const estimate = await estimateSeconds({
    modelId: model.id,
    provider: route.kind === 'direct' ? route.provider.id : 'fal',
    resolution: q.get('resolution') || undefined,
    quality: q.get('quality') || undefined,
    clipSeconds: Number.parseInt(q.get('duration') || '', 10) || undefined,
  })
  return NextResponse.json(
    estimate ? { known: true, ...estimate } : { known: false },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
