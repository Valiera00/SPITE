import { NextRequest, NextResponse } from 'next/server'
import {
  createMcpToken, forgetVerifiedMcpToken, getMcpStatus, revokeMcpToken, setMcpHourlyLimitUsd,
} from '@/lib/mcp/access'
import { logEvent } from '@/lib/events'

// Settings → Claude connection. Behind the login like every other settings
// route. The token itself leaves the server exactly once: in the response to
// 'enable'. Never log a response body from here.
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

function sameHost(origin: string, host: string | null): boolean {
  try {
    return !!host && new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

export async function GET() {
  try {
    return NextResponse.json(await getMcpStatus(), { headers: noStore })
  } catch (err) {
    console.error('[settings/mcp] status failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Couldn’t read the connection status.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // The login cookie is sent on requests from other pages on the same site
  // (any other port on localhost counts), so a page elsewhere could post here
  // on the owner's behalf. Two things it cannot do: send a JSON content type
  // without the browser asking this server first, or hide where it came from.
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 415 })
  }
  const origin = request.headers.get('origin')
  if (origin && !sameHost(origin, request.headers.get('host'))) {
    return NextResponse.json({ error: 'Not allowed from another site.' }, { status: 403 })
  }
  try {
    const body = await request.json().catch(() => null)
    const action = body?.action

    if (action === 'enable') {
      const token = await createMcpToken()
      forgetVerifiedMcpToken()
      await logEvent('info', 'Claude connection turned on (new token)')
      return NextResponse.json({ ...(await getMcpStatus()), token }, { headers: noStore })
    }
    if (action === 'disable') {
      await revokeMcpToken()
      forgetVerifiedMcpToken()
      await logEvent('info', 'Claude connection turned off')
      return NextResponse.json(await getMcpStatus(), { headers: noStore })
    }
    if (action === 'limit') {
      const usd = Number(body?.hourlyLimitUsd)
      if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) {
        return NextResponse.json({ error: 'Enter an amount from 0 up.' }, { status: 400 })
      }
      await setMcpHourlyLimitUsd(usd)
      return NextResponse.json(await getMcpStatus(), { headers: noStore })
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    console.error('[settings/mcp] update failed:', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Couldn’t save. Try again.' }, { status: 500 })
  }
}
