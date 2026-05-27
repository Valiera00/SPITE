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

      // Persist outputs into our own R2 (fal URLs are temporary) and record
      // each in the asset library. Re-hosting falls back to the fal URL on
      // error so a storage hiccup never loses the generation.
      if (output.url) {
        try {
          const isVideo = !!output.videos
          const prompt = searchParams.get('prompt') || 'Generated asset'
          const projectId = searchParams.get('projectId')
          const canRecord = !!projectId && projectId !== 'undefined' && projectId !== 'null'

          const rehost = async (u: string) => {
            if (u.startsWith('http')) {
              try {
                return await rehostToR2(u)
              } catch (rehostErr) {
                console.error('[r2] Re-host failed, keeping fal URL:', rehostErr)
              }
            }
            return u
          }

          if (isVideo) {
            const stored = await rehost(output.url)
            output.url = stored
            if (output.videos?.length) output.videos[0] = stored
            if (canRecord) await recordAsset('video', model, prompt, stored, projectId!)
          } else {
            // One or more images — re-host + record each, preserving order.
            const sources = output.images?.length ? output.images : [output.url]
            const stored: string[] = []
            for (const u of sources) {
              const s = await rehost(u)
              stored.push(s)
              if (canRecord) await recordAsset('image', model, prompt, s, projectId!)
            }
            output.images = stored
            output.url = stored[0]
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
