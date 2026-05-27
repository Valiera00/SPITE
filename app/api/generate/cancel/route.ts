import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }

  const { request_id, model } = await request.json()
  if (!request_id || !model) {
    return NextResponse.json({ error: 'request_id and model are required' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://queue.fal.run/${model}/requests/${request_id}/cancel`, {
      method: 'PUT',
      headers: { 'Authorization': `Key ${falKey}` },
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }

    console.log(`[fal.ai] Cancelled: request_id=${request_id}`)
    return NextResponse.json({ success: true, request_id })
  } catch (error: any) {
    console.error('[fal.ai] Cancel error:', error)
    return NextResponse.json({ error: error.message || 'Cancel failed' }, { status: 500 })
  }
}
