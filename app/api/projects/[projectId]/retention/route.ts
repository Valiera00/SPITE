import { NextRequest, NextResponse } from 'next/server'
import {
  getAssetRetentionDays,
  getProjectAssetRetentionOverride,
  setProjectAssetRetentionDays,
} from '@/lib/retention'

// Per-project auto-delete window for unused results.
//   GET → { overrideDays: number | null, globalDays, effectiveDays }
//   PUT → { days: number | null }   null = inherit the global window, 0 = never
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const overrideDays = await getProjectAssetRetentionOverride(projectId)
  const globalDays = await getAssetRetentionDays()
  return NextResponse.json({ overrideDays, globalDays, effectiveDays: overrideDays ?? globalDays })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const body = await request.json().catch(() => ({}))
    const raw = body?.days
    let days: number | null
    if (raw === null || raw === undefined || raw === '') days = null
    else {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > 3650) {
        return NextResponse.json({ error: 'days must be a whole number from 0 to 3650, or null to inherit' }, { status: 400 })
      }
      days = Math.floor(n)
    }
    await setProjectAssetRetentionDays(projectId, days)
    const overrideDays = await getProjectAssetRetentionOverride(projectId)
    const globalDays = await getAssetRetentionDays()
    return NextResponse.json({ overrideDays, globalDays, effectiveDays: overrideDays ?? globalDays })
  } catch (error) {
    console.error('[projects/retention] save failed:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
