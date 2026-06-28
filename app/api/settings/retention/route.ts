import { NextResponse } from 'next/server'
import { getAssetRetentionDays, getReferenceRetentionDays } from '@/lib/retention'

// Read-only: report the currently-effective retention windows so the Settings
// page can describe exactly what the nightly cleanup will do. The values are
// configured via env vars (ASSET_RETENTION_DAYS / REFERENCE_RETENTION_DAYS) and
// take effect on redeploy — same model as the API key and app password.
export async function GET() {
  return NextResponse.json({
    assetRetentionDays: getAssetRetentionDays(),
    referenceRetentionDays: getReferenceRetentionDays(),
  })
}
