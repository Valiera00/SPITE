import { NextRequest, NextResponse } from 'next/server'
import { listEvents, markAllSeen, noteVersion } from '@/lib/events'

// GET  → the latest events plus how many are unseen (feeds the bell).
// POST → { action: 'seen' } marks everything seen;
//        { action: 'version', version } records the running build, logging an
//        "updated" event if it changed since the last report.
export async function GET() {
  try {
    return NextResponse.json(await listEvents(50))
  } catch (error) {
    console.error('[events] list failed:', error)
    return NextResponse.json({ events: [], unseen: 0 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    if (body?.action === 'seen') {
      await markAllSeen()
      return NextResponse.json({ ok: true })
    }
    if (body?.action === 'version') {
      await noteVersion(String(body.version || ''))
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[events] update failed:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
