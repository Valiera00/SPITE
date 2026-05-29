import { NextRequest, NextResponse } from 'next/server'
import { getModelById, buildModelInput } from '@/lib/fal-models'
import { toFalFetchableUrl } from '@/lib/r2-upload'

export async function POST(request: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json(
      { error: 'FAL_KEY not configured' },
      { status: 500 }
    )
  }

  const { modelId, prompt, referenceImageUrl, endImageUrl, referenceImageUrls, settings } = await request.json()

  if (!modelId || !prompt) {
    return NextResponse.json({ error: 'modelId and prompt are required' }, { status: 400 })
  }

  const model = getModelById(modelId)
  if (!model) {
    return NextResponse.json({ error: `Unknown model: ${modelId}` }, { status: 400 })
  }

  // Reference media is stored behind our private R2 proxy. Turn it into an
  // absolute, token-signed proxy URL fal.ai can fetch (1-hour validity).
  const host = request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const baseUrl = host ? `${proto}://${host}` : ''
  const referenceImageSigned = toFalFetchableUrl(referenceImageUrl, baseUrl)
  const endImageSigned = toFalFetchableUrl(endImageUrl, baseUrl)
  const refsSigned: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.map((u: string) => toFalFetchableUrl(u, baseUrl)).filter(Boolean) as string[]
    : []

  // Reference images use a different endpoint/param per model:
  //  - Models with `referenceParam` (Seedance 2.0, Kling v3, Kling o1/1.6,
  //    MiniMax) carry refs in a dedicated field; some of those have a
  //    `referenceModel` endpoint that does NOT accept first/end frames.
  //  - Models WITHOUT `referenceParam` (Nano Banana, FLUX Dev) reuse their
  //    image input slot — folder-mention refs ride alongside the connected
  //    image (or alone) inside `image_urls`/`image_url`. For those we still
  //    need to switch to `editModel`, since the plain endpoint ignores any
  //    image input.
  const hasFolderRefs = refsSigned.length > 0
  const hasRefsViaRefParam = hasFolderRefs && !!model.referenceParam
  const hasRefsViaImageParam =
    hasFolderRefs && !model.referenceParam && !!model.imageParam
  const usesSeparateRefEndpoint = hasRefsViaRefParam && !!model.referenceModel
  const hasFrame = !!(referenceImageUrl || endImageUrl) && model.inputTypes.includes('image')

  // fal only uses references the prompt cites (@Image1 / @Element1). Auto-append
  // citations if the user didn't write any.
  let finalPrompt: string = prompt
  if (hasRefsViaRefParam && model.referenceCite && !/@(image|element)\d/i.test(prompt)) {
    const cites = refsSigned.map((_, i) => `${model.referenceCite}${i + 1}`).join(' ')
    finalPrompt = `${prompt} ${cites}`.trim()
  }

  // Build the input using model-specific parameter mapping. Always pass the
  // folder refs through — buildModelInput decides whether they flow into
  // imageParam (image_urls/image_url) or referenceParam.
  const input = buildModelInput(model, finalPrompt, {
    aspectRatio: settings?.aspectRatio,
    duration: settings?.duration,
    resolution: settings?.resolution,
    enableAudio: settings?.enableAudio,
    enableLoop: settings?.enableLoop,
    // Separate reference endpoints don't accept first/end frame inputs.
    imageUrl: usesSeparateRefEndpoint ? undefined : (referenceImageSigned || undefined),
    endImageUrl: usesSeparateRefEndpoint ? undefined : (endImageSigned || undefined),
    referenceImageUrls: hasFolderRefs ? refsSigned : undefined,
  })

  // Batch image count — image models only (video models produce one clip).
  if (model.category === 'image' && settings?.numImages) {
    input.num_images = Math.max(1, Math.min(4, Number(settings.numImages) || 1))
  }

  // Video-to-video: pass a connected source video through if provided
  // (also signed so fal can fetch it).
  if (settings?.videoUrl) {
    input.video_url = toFalFetchableUrl(settings.videoUrl, baseUrl)
  }

  // Pick the endpoint: separate reference endpoint > image-to-image /
  // image-to-video (frames, elements-style refs, OR image-slot refs from
  // folder mentions on models like Nano Banana / FLUX Dev) > text-to-video.
  let endpoint = model.falModel
  if (usesSeparateRefEndpoint) {
    endpoint = model.referenceModel!
  } else if ((hasRefsViaRefParam || hasRefsViaImageParam || hasFrame) && model.editModel) {
    endpoint = model.editModel
  }

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
