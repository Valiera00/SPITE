import { NextResponse } from 'next/server'
import { routedPricing } from '@/lib/model-routing'

// Which SPITE models the submit route sends somewhere other than fal, and
// whose price table applies, so the browser can price them correctly. Says
// nothing about keys beyond "routed".
export async function GET() {
  return NextResponse.json({ routed: await routedPricing() }, { headers: { 'Cache-Control': 'no-store' } })
}
