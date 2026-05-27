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

  // Batch image count — image models only (video models produce one clip).
  if (model.category === 'image' && settings?.numImages) {
    input.num_images = Math.max(1, Math.min(4, Number(settings.numImages) || 1))
  }

  // Video-to-video: pass a connected source video through if provided.
  if (settings?.videoUrl) {
    input.video_url = settings.videoUrl
  }

  // When a reference image is supplied and the model has a dedicated edit /
  // image-to-video endpoint, submit there instead of the text endpoint.
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

    // fal returns the exact status/result URLs for this job. Derive the queue
    // path fal expects for polling from status_url — this is authoritative and
    // handles every case (/edit strips to base, image-to-video keeps its path,
    // etc.) instead of us guessing. Fall back to falModel if absent.
    let pollModel = model.falModel
    const m = typeof data.status_url === 'string'
      ? data.status_url.match(/queue\.fal\.run\/(.+?)\/requests\//)
      : null
    if (m) pollModel = m[1]

    return NextResponse.json({
      request_id: data.request_id,
      model: pollModel,
      modelId: model.id,
      category: model.category,
    })
  } catch (error: any) {
    console.error('[fal.ai] Submit error:', error)
    return NextResponse.json({ error: error.message || 'Submit failed' }, { status: 500 })
  }
}
