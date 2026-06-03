'use client'

import useSWR from 'swr'
import { Coins, ArrowsClockwise } from '@phosphor-icons/react'

interface BalanceResponse {
  available?: boolean
  balance?: number
  currency?: string
  source?: string
  error?: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function format(balance: number, currency: string): string {
  if (currency === 'USD' || !currency) {
    if (Math.abs(balance) < 1000) return `$${balance.toFixed(2)}`
    return `$${balance.toFixed(0)}`
  }
  return `${balance.toFixed(2)} ${currency}`
}

// Color tint by balance level. Below $5 is "watch it" yellow, below 0
// is overdrawn red. The user said they don't want a hard cap, just
// ambient awareness — so this is purely informational, never a block.
function tone(balance: number): string {
  if (balance < 0) return 'text-red-400'
  if (balance < 5) return 'text-amber-400'
  if (balance < 20) return 'text-amber-300/80'
  return 'text-foreground/60'
}

export function FalBalanceBadge() {
  // Refresh every 30 s so the user sees their spend tick down in near
  // real time while they work, without hammering fal.
  const { data, isLoading, mutate } = useSWR<BalanceResponse>(
    '/api/fal/balance',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true },
  )

  const available = data?.available && typeof data.balance === 'number'
  const balance = available ? (data!.balance as number) : null
  const currency = data?.currency || 'USD'

  return (
    <button
      onClick={() => mutate()}
      className="group flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-white/5 transition-colors select-none"
      title={
        available
          ? `fal.ai balance: ${format(balance!, currency)} · click to refresh`
          : data?.error
            ? `Balance unavailable: ${data.error}`
            : 'fal.ai balance unavailable — click to retry'
      }
    >
      <Coins size={11} weight="thin" className="text-muted-foreground/70" />
      <span
        className={`text-[10px] font-mono tracking-wider ${
          available && balance !== null ? tone(balance) : 'text-muted-foreground/40'
        }`}
      >
        {isLoading
          ? '…'
          : available && balance !== null
            ? format(balance, currency)
            : '—'}
      </span>
      <ArrowsClockwise
        size={9}
        weight="thin"
        className="text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </button>
  )
}
