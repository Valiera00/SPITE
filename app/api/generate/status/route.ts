import { NextRequest, NextResponse } from 'next/server'
import { recordAsset, rehostToR2 } from '@/lib/r2-upload'

export async function GET(request: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const requestId = searchParams.get('request_id')
  const model = searchParams.get('model')

  if (!requestId || !model) {
    return NextResponse.json({ error: 'request_id and model are required' }, { status: 400 })
  }

  try {
    // Check status via fal.ai REST API
    const statusRes = await fetch(`https://queue.fal.run/${model}/requests/${requestId}/status`, {
      headers: { 'Authorization': `Key ${falKey}` },
    })

    if (!statusRes.ok) {
      const text = await statusRes.text()
      console.error('[fal.ai] Status check failed:', statusRes.status, text)
      return NextResponse.json({ error: text }, { status: statusRes.status })
    }

    const statusData = await statusRes.json()
    const status = statusData.status // 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

    if (status === 'COMPLETED') {
      // Fetch the result
      const resultRes = await fetch(`https://queue.fal.run/${model}/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${falKey}` },
      })
      
      if (!resultRes.ok) {
        // Result not ready yet - treat as still in progress
        const errText = await resultRes.text()
        console.error('[fal.ai] Result fetch failed:', resultRes.status, errText)
        // Don't fail - return as still processing so client keeps polling
        return NextResponse.json({
          status: 'IN_PROGRESS',
          requestId,
        })
      }
      
      const result = await resultRes.json()
      console.log('[fal.ai] Result received:', JSON.stringify(result).slice(0, 200))
      
      const output = extractOutputUrls(result)

      // Persist the output into our own R2 (fal URLs are temporary) and record
      // it in the asset library. Re-hosting falls back to the fal URL on error
      // so a storage hiccup never loses the generation.
      if (output.url) {
        try {
          const isVideo = !!output.videos
          let storedUrl = output.url

          // Only re-host external (fal) URLs, not already-proxied ones.
          if (storedUrl.startsWith('http')) {
            try {
              storedUrl = await rehostToR2(output.url)
              output.url = storedUrl
              if (output.images?.length) output.images[0] = storedUrl
              if (output.videos?.length) output.videos[0] = storedUrl
            } catch (rehostErr) {
              console.error('[r2] Re-host failed, keeping fal URL:', rehostErr)
            }
          }

          const prompt = searchParams.get('prompt') || 'Generated asset'
          const projectId = searchParams.get('projectId')
          if (projectId && projectId !== 'undefined' && projectId !== 'null') {
            await recordAsset(isVideo ? 'video' : 'image', model, prompt, storedUrl, projectId)
          }
        } catch (err) {
          console.error('[r2] Failed to record asset:', err)
          // Don't fail the response - asset still generated
        }
      }

      return NextResponse.json({
        status: 'COMPLETED',
        output,
        requestId,
      })
    }

    if (status === 'FAILED') {
      return NextResponse.json({
        status: 'FAILED',
        error: statusData.error || 'Generation failed',
        requestId,
      })
    }

    return NextResponse.json({
      status,
      position: statusData.queue_position,
      requestId,
    })
  } catch (error: any) {
    console.error('[fal.ai] Status error:', error)
    return NextResponse.json({ error: error.message || 'Status check failed' }, { status: 500 })
  }
}

function extractOutputUrls(result: any): { images?: string[], videos?: string[], url?: string } {
  const output: { images?: string[], videos?: string[], url?: string } = {}

  if (result.images?.length) {
    const imgs = result.images.map((img: any) => typeof img === 'string' ? img : img.url) as string[]
    output.images = imgs
    output.url = imgs[0]
  }
  if (result.image?.url) {
    output.images = [result.image.url]
    output.url = result.image.url
  }
  if (result.video?.url) {
    output.videos = [result.video.url]
    output.url = result.video.url
  }
  if (result.output?.url) {
    output.url = result.output.url
  }

  return output
}
