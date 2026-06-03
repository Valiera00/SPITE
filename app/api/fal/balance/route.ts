import { NextResponse } from 'next/server'

// Proxy to fal's billing/balance endpoint. Returns the user's current
// account balance so the canvas toolbar can show "fal: $X.XX" with
// ambient awareness while the user works.
//
// fal's REST API is undocumented at this URL path so we treat it
// best-effort: if the call fails (404, schema mismatch, etc.) the route
// returns { available: false } and the UI falls back to a dash. Worst
// case: no balance display. Best case: real-time spend visibility.
//
// Don't cache aggressively — the user wants to see their spend tick
// down in real time. Cap at ~15 seconds of edge caching to avoid
// hammering fal.
export const dynamic = 'force-dynamic'

interface FalBalanceResponse {
  balance?: number
  available?: boolean
  currency?: string
  source?: string
  error?: string
}

async function tryEndpoint(url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { headers, cache: 'no-store' })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

export async function GET() {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return NextResponse.json<FalBalanceResponse>(
      { available: false, error: 'FAL_KEY not configured' },
      { status: 500 },
    )
  }

  // fal hosts an internal billing API at rest.alpha.fal.ai. The exact
  // path isn't publicly documented and may change — we try a couple of
  // known shapes and return the first one that yields a numeric
  // balance. If both fail the toolbar shows a dash; the user can
  // always check fal.ai/billing directly.
  const headers = {
    Authorization: `Key ${falKey}`,
    Accept: 'application/json',
  }

  const candidates = [
    'https://rest.alpha.fal.ai/billing/user-balance',
    'https://rest.alpha.fal.ai/billing/balance',
    'https://api.fal.ai/billing/balance',
    'https://api.fal.ai/users/me',
  ]

  for (const url of candidates) {
    const data = await tryEndpoint(url, headers)
    if (!data) continue

    // Try a handful of likely field paths. fal has been seen returning
    // `{ balance: 12.34 }`, `{ user: { balance: 12.34 } }`, and
    // `{ available_credit_in_cents: 1234 }` in various endpoints over
    // the years.
    const numericBalance =
      typeof data.balance === 'number' ? data.balance :
      typeof data.amount === 'number' ? data.amount :
      typeof data?.user?.balance === 'number' ? data.user.balance :
      typeof data?.available_credit_in_cents === 'number' ? data.available_credit_in_cents / 100 :
      typeof data?.credits === 'number' ? data.credits :
      null

    if (numericBalance !== null) {
      return NextResponse.json<FalBalanceResponse>({
        available: true,
        balance: numericBalance,
        currency: typeof data.currency === 'string' ? data.currency : 'USD',
        source: url,
      })
    }
  }

  return NextResponse.json<FalBalanceResponse>(
    { available: false, error: 'No supported fal balance endpoint responded successfully.' },
    { status: 200 },
  )
}
