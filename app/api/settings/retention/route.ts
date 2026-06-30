import { NextRequest, NextResponse } from 'next/server'
import { getAssetRetentionDays, getReferenceRetentionDays, setRetentionDays } from '@/lib/retention'

// Report the currently-effective retention windows (DB override → env → default).
export async function GET() {
  return NextResponse.json({
    assetRetentionDays: await getAssetRetentionDays(),
    referenceRetentionDays: await getReferenceRetentionDays(),
  })
}

// Save new windows from Settings → Data Retention. Whole, non-negative days;
// 0 disables that window (never delete). Takes effect on the next nightly run.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const asset = Number(body?.assetRetentionDays)
    const reference = Number(body?.referenceRetentionDays)
    if (![asset, reference].every((n) => Number.isFinite(n) && n >= 0)) {
      return NextResponse.json({ error: 'Days must be whole numbers ≥ 0.' }, { status: 400 })
    }
    await setRetentionDays(asset, reference)
    return NextResponse.json({
      assetRetentionDays: await getAssetRetentionDays(),
      referenceRetentionDays: await getReferenceRetentionDays(),
    })
  } catch (error) {
    console.error('[settings/retention] save error:', error)
    return NextResponse.json({ error: 'Failed to save retention settings' }, { status: 500 })
  }
}
