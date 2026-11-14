import { NextRequest, NextResponse } from 'next/server'
import { getMcpStatus } from '@/lib/mcp/access'
import { boardInbox, markPlaced } from '@/lib/mcp/store'

// Drafts Claude was told to keep, waiting to go on this project's board.
//
// The canvas is the only writer of its own nodes (a save replaces them all),
// so the MCP endpoint never inserts a node. It queues the draft here; the open
// canvas reads the queue, adds the nodes itself, and confirms with POST.
//
// `enabled: false` tells the canvas the Claude connection is off, so it can
// stop asking.
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const { enabled } = await getMcpStatus()
    if (!enabled) return NextResponse.json({ enabled: false, items: [] })
    const items = (await boardInbox(projectId)).map((d) => ({
      number: d.number,
      assetId: d.assetId,
      url: d.url,
      type: d.type,
      prompt: d.prompt,
      modelId: d.modelId,
      aspectRatio: typeof d.settings.aspectRatio === 'string' ? d.settings.aspectRatio : undefined,
      resolution: typeof d.settings.resolution === 'string' ? d.settings.resolution : undefined,
      quality: typeof d.settings.quality === 'string' ? d.settings.quality : undefined,
    }))
    return NextResponse.json({ enabled: true, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[board-inbox] read failed:', err instanceof Error ? err.message : 'unknown')
    // Not worth an error state on the canvas: it just asks again later.
    return NextResponse.json({ enabled: true, items: [] })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const body = await request.json().catch(() => null)
    const numbers: number[] = Array.isArray(body?.placed)
      ? body.placed.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 200)
      : []
    await markPlaced(projectId, numbers)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[board-inbox] confirm failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
