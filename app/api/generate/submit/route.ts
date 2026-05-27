import { NextRequest, NextResponse } from 'next/server'
import { getModelById, buildModelInput } from '@/lib/fal-models'

export async function POST(request: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json(
      { error: 'FAL_KEY not configured' },
      { status: 500 }
    )
  }

  const { modelId, prompt, referenceImageUrl, settings } = await request.json()

  if (!modelId || !prompt) {
    return NextResponse.json({ error: 'modelId and prompt are required' }, { status: 400 })
  }

  const model = getModelById(modelId)
  if (!model) {
    return NextResponse.json({ error: `Unknown model: ${modelId}` }, { status: 400 })
  }

  // Build the input using model-specific parameter mapping
  const input = buildModelInput(model, prompt, {
    aspectRatio: settings?.aspectRatio,
    duration: settings?.duration,
    resolution: settings?.resolution,
    enableAudio: settings?.enableAudio,
    enableLoop: settings?.enableLoop,
    imageUrl: referenceImageUrl,
  })

  // When a reference image is supplied and the model has a dedicated edit
  // endpoint, submit there instead of the text-to-image endpoint.
  const hasReferenceImage = !!referenceImageUrl && model.inputTypes.includes('image')
  const endpoint = hasReferenceImage && model.editModel ? model.editModel : model.falModel

  console.log(`[fal.ai] Submitting: model=${endpoint}`, JSON.stringify(input))

  try {
    // Submit to fal.ai queue using REST API directly
    const res = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[fal.ai] Submit failed:', res.status, text)
      return NextResponse.json(
        { error: text || `fal.ai returned ${res.status}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    console.log(`[fal.ai] Submitted, request_id=${data.request_id}`)

    return NextResponse.json({
      request_id: data.request_id,
      model: endpoint,
      modelId: model.id,
      category: model.category,
    })
  } catch (error: any) {
    console.error('[fal.ai] Submit error:', error)
    return NextResponse.json({ error: error.message || 'Submit failed' }, { status: 500 })
  }
}
