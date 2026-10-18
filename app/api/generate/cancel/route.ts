import { NextRequest, NextResponse } from 'next/server'
import { isValidFalModel, isValidFalRequestId } from '@/lib/fal-validate'
import { isByteplusEndpoint, isValidByteplusEndpoint, isValidByteplusTaskId, cancelByteplusTask } from '@/lib/byteplus'

export async function POST(request: NextRequest) {
  const { request_id, model } = await request.json()
  if (!request_id || !model) {
    return NextResponse.json({ error: 'request_id and model are required' }, { status: 400 })
  }

  // Jobs submitted straight to BytePlus (lib/byteplus.ts).
  if (isByteplusEndpoint(model)) {
    if (!isValidByteplusEndpoint(model) || !isValidByteplusTaskId(request_id)) {
      return NextResponse.json({ error: 'Invalid model or request_id' }, { status: 400 })
    }
    try {
      await cancelByteplusTask(request_id)
      console.log(`[byteplus] Cancelled: task=${request_id}`)
      return NextResponse.json({ success: true, request_id })
    } catch (error) {
      console.error('[byteplus] Cancel error:', error)
      return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })
    }
  }

  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
  }
  if (!isValidFalModel(model) || !isValidFalRequestId(request_id)) {
    return NextResponse.json({ error: 'Invalid model or request_id' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://queue.fal.run/${model}/requests/${request_id}/cancel`, {
      method: 'PUT',
      headers: { 'Authorization': `Key ${falKey}` },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Cancel failed' }, { status: res.status })
    }

    console.log(`[fal.ai] Cancelled: request_id=${request_id}`)
    return NextResponse.json({ success: true, request_id })
  } catch (error: any) {
    console.error('[fal.ai] Cancel error:', error)
    return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })
  }
}
