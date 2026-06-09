import { NextRequest, NextResponse } from 'next/server'
import { getModelById, buildModelInput } from '@/lib/fal-models'
import { toFalFetchableUrl } from '@/lib/r2-upload'
import { estimateGenerationCost } from '@/lib/fal-cost'
import { reserveSpend, rollbackSpend } from '@/lib/spend-gate'

export async function POST(request: NextRequest) {
  // KILL SWITCH — set GENERATION_DISABLED=1 in Vercel env vars to halt
  // every new fal submission across the app without redeploying client
  // code. Returns a clear 503 so the node UI shows a clean error.
  // Re-enable by removing the env var (or setting it to anything else).
  if (process.env.GENERATION_DISABLED === '1') {
    console.warn('[generate/submit] blocked — GENERATION_DISABLED is set')
    return NextResponse.json(
      {
        error:
          'Generation is currently disabled by admin (GENERATION_DISABLED env var). No fal charges will be incurred. Remove the env var on Vercel to re-enable.',
      },
      { status: 503 }
    )
  }

  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json(
      { error: 'FAL_KEY not configured' },
      { status: 500 }
    )
  }

  const {
    modelId,
    prompt,
    referenceImageUrl,
    endImageUrl,
    referenceImageUrls,
    referenceGroups,
    settings,
  } = await request.json()

  if (!modelId) {
    return NextResponse.json({ error: 'modelId is required' }, { status: 400 })
  }

  const model = getModelById(modelId)
  if (!model) {
    return NextResponse.json({ error: `Unknown model: ${modelId}` }, { status: 400 })
  }

  // Prompt is required only if the model accepts text input AND doesn't
  // mark it as optional. Topaz Upscale declares text in inputTypes (so
  // the field shows in the node) but flags optionalPrompt: true so an
  // empty prompt is a valid "plug-n-play" submission.
  if (model.inputTypes.includes('text') && !model.optionalPrompt && !prompt) {
    return NextResponse.json({ error: 'prompt is required for this model' }, { status: 400 })
  }

  // Server-side spend gate. Defence against a captured cookie being
  // weaponised into a billing attack — the client-side $25 confirm is
  // UX, not a control. Recompute the cost from the modelId here (don't
  // trust the client) and refuse if this submission would push the
  // last-hour total over SPEND_LIMIT_USD_PER_HOUR.
  const requestedUnits = Math.max(
    1,
    Math.min(
      4,
      Number(settings?.numImages) || Number(settings?.numVideos) || 1,
    ),
  )
  const durationSeconds = settings?.duration
    ? Number.parseInt(String(settings.duration), 10) || undefined
    : undefined
  const costEstimate = estimateGenerationCost(model, {
    count: requestedUnits,
    durationSeconds,
  })
  // Fail-closed on unknown cost: a model declared in lib/fal-models.ts but
  // missing from lib/fal-cost.ts would otherwise estimate $0 and bypass the
  // gate entirely (the original $200 incident pattern). Refuse rather than
  // guess — adding the model to fal-cost.ts is a one-line fix.
  if (!costEstimate.isKnown) {
    console.error(`[generate/submit] no cost entry for model "${model.id}" — refusing to submit`)
    return NextResponse.json(
      {
        error:
          `Server refuses to submit "${model.id}" — this model has no entry in lib/fal-cost.ts ` +
          `so the spend gate can't evaluate it. Add a price entry and redeploy.`,
      },
      { status: 422 },
    )
  }
  // Atomic reserve — combines the previous separate gate-check + ledger-write
  // into one SQL statement so concurrent submits can't both pass the same
  // pre-spend total. ledgerId is returned for rollback if fal rejects below.
  const reservation = await reserveSpend(model.id, costEstimate.total)
  if (!reservation.allowed) {
    return NextResponse.json(
      {
        error:
          `Spend gate blocked this submission: $${reservation.projectedTotalUsd.toFixed(2)} ` +
          `would exceed the $${reservation.limitUsd}/hour ceiling ` +
          `(already $${reservation.spentLastHourUsd.toFixed(2)} this hour). ` +
          `Raise SPEND_LIMIT_USD_PER_HOUR or wait for the window to roll over.`,
        spentLastHourUsd: reservation.spentLastHourUsd,
        limitUsd: reservation.limitUsd,
        projectedTotalUsd: reservation.projectedTotalUsd,
      },
      { status: 429 },
    )
  }

  // Reference media is stored behind our private R2 proxy. Turn it into an
  // absolute, token-signed proxy URL fal.ai can fetch (1-hour validity).
  //
  // Choosing the base URL is non-obvious: Vercel preview deployments are
  // gated by Deployment Protection by default, which means fal.ai (no
  // cookie, no bypass token) can't reach /api/r2-image on a preview.
  // Production deployments are publicly accessible on the same project,
  // share the same DATABASE_URL and APP_PASSWORD (signing secret), and
  // can serve the same image bytes — so we always sign references using
  // the production URL when we know it. Order of preference:
  //   1. SITE_URL — explicit override, for self-hosters with a custom
  //      domain or non-Vercel host.
  //   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel auto-injects this on
  //      every deploy; points at the public production hostname.
  //   3. request.headers.get('host') — last resort. Works for local
  //      dev and for any setup with no protection.
  function getPublicBaseUrl(): string {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    }
    const host = request.headers.get('host')
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return host ? `${proto}://${host}` : ''
  }
  const baseUrl = getPublicBaseUrl()
  // TEMP diagnostic — surfaces which URL fal will be told to fetch
  // references from. If this prints the preview URL (long, with the
  // commit-hash and team slug) instead of a clean production URL,
  // VERCEL_PROJECT_PRODUCTION_URL isn't being injected and the user
  // needs to set SITE_URL explicitly.
  console.log('[generate/submit] baseUrl for fal references:', baseUrl, {
    SITE_URL_set: !!process.env.SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL_set: !!process.env.VERCEL_PROJECT_PRODUCTION_URL,
  })
  const referenceImageSigned = toFalFetchableUrl(referenceImageUrl, baseUrl)
  const endImageSigned = toFalFetchableUrl(endImageUrl, baseUrl)
  // Accept either grouped refs (preferred) or the legacy flat list. Sign
  // every URL per-group so the structure can be preserved for
  // element-based models (Kling v3 elements).
  type IncomingGroup = { urls?: string[]; folderName?: string; folderType?: string }
  const refGroupsSigned: { urls: string[] }[] = Array.isArray(referenceGroups)
    ? (referenceGroups as IncomingGroup[]).map((g) => ({
        urls: Array.isArray(g.urls)
          ? (g.urls
              .map((u) => toFalFetchableUrl(u, baseUrl))
              .filter(Boolean) as string[])
          : [],
      })).filter((g) => g.urls.length > 0)
    : Array.isArray(referenceImageUrls)
      ? (referenceImageUrls as string[])
          .map((u) => toFalFetchableUrl(u, baseUrl))
          .filter(Boolean)
          .map((u) => ({ urls: [u as string] }))
      : []
  const refsSigned: string[] = refGroupsSigned.flatMap((g) => g.urls)

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
  // imageParam (image_urls/image_url) or referenceParam. Grouped form is
  // preferred so element-based models can build one element per subject.
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
    referenceGroups: hasFolderRefs ? refGroupsSigned : undefined,
    // Pass through the upscaler mode so buildModelInput can pick the
    // right Topaz model variant (Proteus vs Starlight HQ).
    upscaleMode: settings?.upscaleMode,
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
      // Roll back the spend reservation — fal rejected the work, the
      // ledger shouldn't pretend it was queued.
      await rollbackSpend(reservation.ledgerId)
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
    // Network failure / unexpected throw — roll back the reservation
    // so a flaky link doesn't permanently consume the per-hour budget.
    await rollbackSpend(reservation.ledgerId)
    // Generic error to client — don't surface raw error.message which
    // could leak internal hostnames, header dumps, etc.
    return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
  }
}
