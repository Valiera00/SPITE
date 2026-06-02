import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { recordAsset, rehostToR2 } from '@/lib/r2-upload'

// Recovery endpoint. fal keeps job results around for ~24h after completion,
// so a generation that "disappeared" from FRAME — because polling failed,
// the user refreshed, the 10-min soft timeout fired, or the node was
// deleted — is usually still retrievable as long as we know the request_id.
//
// Two modes:
//
// 1) Bulk auto-recover. POST {} (or {projectId}) — scans canvas_nodes for
//    any node carrying a `pendingRequestId` + `pendingFalEndpoint` in data,
//    asks fal for each, re-hosts completed outputs into our R2, and
//    records them in generation_history (the assets library). Use this
//    when the user clicks "Recover stuck generations" in Settings.
//
// 2) Manual single recovery. POST { requestId, modelEndpoint, projectId,
//    type? } — pull one specific request that the user located via the
//    fal.ai dashboard. Useful for jobs whose pendingRequestId was already
//    cleared from the node (e.g. user hit Cancel before knowing fal might
//    still complete it).
//
// In both modes the response describes every request that was attempted
// and what happened to it, so the UI / console can summarize.

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }
  return neon(process.env.DATABASE_URL)
}

interface RecoveryItem {
  requestId: string
  modelEndpoint: string
  projectId: string
  // Used for sensible defaults when the node type is unknown (manual mode).
  hintedType?: 'image' | 'video'
  // For bulk mode: link the result back to the node it came from.
  nodeId?: string
  prompt?: string
}

interface RecoveryResult {
  requestId: string
  nodeId?: string
  status: 'recovered' | 'still_pending' | 'failed' | 'not_found' | 'error'
  assetUrl?: string
  message?: string
}

async function fetchFalStatus(requestId: string, modelEndpoint: string, falKey: string) {
  const statusRes = await fetch(
    `https://queue.fal.run/${modelEndpoint}/requests/${requestId}/status`,
    { headers: { Authorization: `Key ${falKey}` } },
  )
  return statusRes
}

async function fetchFalResult(requestId: string, modelEndpoint: string, falKey: string) {
  const res = await fetch(
    `https://queue.fal.run/${modelEndpoint}/requests/${requestId}`,
    { headers: { Authorization: `Key ${falKey}` } },
  )
  return res
}

function extractOutputUrl(result: any): { url: string | null; isVideo: boolean } {
  if (result?.video?.url) return { url: result.video.url, isVideo: true }
  if (result?.output?.url) {
    const url = result.output.url
    const isVideo = /\.(mp4|webm|mov|m4v)(?:\?|$)/i.test(url)
    return { url, isVideo }
  }
  if (result?.videos?.length) {
    const v = result.videos[0]
    const url = typeof v === 'string' ? v : v?.url
    if (url) return { url, isVideo: true }
  }
  if (result?.images?.length) {
    const img = result.images[0]
    const url = typeof img === 'string' ? img : img?.url
    if (url) return { url, isVideo: false }
  }
  if (result?.image?.url) return { url: result.image.url, isVideo: false }
  return { url: null, isVideo: false }
}

async function recoverOne(item: RecoveryItem, falKey: string): Promise<RecoveryResult> {
  const statusRes = await fetchFalStatus(item.requestId, item.modelEndpoint, falKey)
  if (statusRes.status === 404) {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'not_found',
      message: 'fal says this request does not exist (may have expired after 24h).',
    }
  }
  if (!statusRes.ok) {
    const text = await statusRes.text().catch(() => '')
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'error',
      message: `status check failed: ${statusRes.status} ${text.slice(0, 200)}`,
    }
  }
  const statusData = await statusRes.json()
  const falStatus = statusData.status as string | undefined

  if (falStatus === 'IN_QUEUE' || falStatus === 'IN_PROGRESS') {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'still_pending',
      message: `fal says ${falStatus}.`,
    }
  }
  if (falStatus === 'FAILED') {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'failed',
      message: 'fal reports the job failed.',
    }
  }
  if (falStatus !== 'COMPLETED') {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'error',
      message: `unexpected fal status: ${falStatus}`,
    }
  }

  const resultRes = await fetchFalResult(item.requestId, item.modelEndpoint, falKey)
  if (!resultRes.ok) {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'error',
      message: `result fetch failed: ${resultRes.status}`,
    }
  }
  const result = await resultRes.json()
  const { url, isVideo: detectedVideo } = extractOutputUrl(result)
  if (!url) {
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'error',
      message: 'fal returned no usable output URL.',
    }
  }

  const isVideo = item.hintedType ? item.hintedType === 'video' : detectedVideo

  // Re-host the fal-hosted URL into our R2 so it survives fal's 24h
  // retention. Falls back to the original URL if re-hosting fails.
  let storedUrl = url
  try {
    storedUrl = await rehostToR2(url)
  } catch (err) {
    console.error('[recover] rehost failed, keeping fal URL:', err)
  }

  try {
    await recordAsset(
      isVideo ? 'video' : 'image',
      item.modelEndpoint,
      item.prompt || 'Recovered generation',
      storedUrl,
      item.projectId,
    )
  } catch (err) {
    console.error('[recover] recordAsset failed:', err)
    return {
      requestId: item.requestId,
      nodeId: item.nodeId,
      status: 'error',
      message: 'Output retrieved but failed to record in assets library.',
      assetUrl: storedUrl,
    }
  }

  return {
    requestId: item.requestId,
    nodeId: item.nodeId,
    status: 'recovered',
    assetUrl: storedUrl,
    message: `Saved as ${isVideo ? 'video' : 'image'} in your assets library.`,
  }
}

export async function POST(request: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))

  // Manual single-request mode.
  if (body.requestId && body.modelEndpoint) {
    if (!body.projectId) {
      return NextResponse.json(
        { error: 'projectId is required so we know where to file the recovered asset.' },
        { status: 400 },
      )
    }
    const result = await recoverOne(
      {
        requestId: String(body.requestId),
        modelEndpoint: String(body.modelEndpoint),
        projectId: String(body.projectId),
        prompt: body.prompt ? String(body.prompt) : undefined,
        hintedType: body.type === 'video' || body.type === 'image' ? body.type : undefined,
      },
      falKey,
    )
    return NextResponse.json({ mode: 'manual', results: [result] })
  }

  // Bulk mode — scan canvas_nodes for any node holding a pendingRequestId.
  const sql = getDb()
  const projectFilter = body.projectId ? String(body.projectId) : null
  const rows = await (projectFilter
    ? sql`
        SELECT projectId, nodeId, data, type
        FROM canvas_nodes
        WHERE projectId = ${projectFilter}::text
          AND data->>'pendingRequestId' IS NOT NULL
          AND data->>'pendingFalEndpoint' IS NOT NULL
      `
    : sql`
        SELECT projectId, nodeId, data, type
        FROM canvas_nodes
        WHERE data->>'pendingRequestId' IS NOT NULL
          AND data->>'pendingFalEndpoint' IS NOT NULL
      `)

  if (rows.length === 0) {
    return NextResponse.json({
      mode: 'bulk',
      scanned: 0,
      results: [],
      message: 'No nodes with pending fal requests were found.',
    })
  }

  // Process sequentially so a slow fal endpoint doesn't fan out into a
  // burst of parallel requests against the same backend.
  const results: RecoveryResult[] = []
  for (const row of rows as any[]) {
    const data = (row.data || {}) as any
    const requestId = String(data.pendingRequestId)
    const modelEndpoint = String(data.pendingFalEndpoint)
    const projectId = String(row.projectid ?? row.projectId)
    const hintedType =
      row.type === 'videoGen' ? 'video' : row.type === 'imageGen' ? 'image' : undefined
    const result = await recoverOne(
      {
        requestId,
        modelEndpoint,
        projectId,
        hintedType,
        nodeId: String(row.nodeid ?? row.nodeId),
        prompt: data.prompt ? String(data.prompt) : undefined,
      },
      falKey,
    )
    results.push(result)
  }

  // Clean up the pending markers on nodes whose request resolved
  // (recovered / failed / not_found) so the canvas isn't stuck "in queue"
  // forever on the next page load.
  const cleared: string[] = results
    .filter(r => r.status === 'recovered' || r.status === 'failed' || r.status === 'not_found')
    .map(r => r.nodeId!)
    .filter(Boolean)
  if (cleared.length) {
    try {
      await sql`
        UPDATE canvas_nodes
        SET data = data
          - 'pendingRequestId'
          - 'pendingFalEndpoint'
          - 'pendingStartedAt'
        WHERE nodeId = ANY(${cleared}::text[])
      `
    } catch (err) {
      console.error('[recover] failed to clear pending markers:', err)
    }
  }

  return NextResponse.json({
    mode: 'bulk',
    scanned: rows.length,
    recovered: results.filter(r => r.status === 'recovered').length,
    stillPending: results.filter(r => r.status === 'still_pending').length,
    failed: results.filter(r => r.status === 'failed').length,
    notFound: results.filter(r => r.status === 'not_found').length,
    errors: results.filter(r => r.status === 'error').length,
    results,
  })
}