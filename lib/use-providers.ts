'use client'

import { useEffect, useState } from 'react'
import type { PricingProvider } from './direct-provider'

// Which models the server will route somewhere other than fal (Settings →
// Model providers, when the key is configured), and whose price applies. The
// browser can't see server env vars, so it asks once per page load. Until the
// answer arrives, estimates use fal's price — never the lower of the two.

export const PROVIDER_LABEL: Record<PricingProvider, string> = {
  fal: 'fal',
  byteplus: 'BytePlus',
  alibaba: 'Alibaba',
  'alibaba-sg': 'Alibaba',
}

type Routed = Record<string, PricingProvider>
let routedPromise: Promise<Routed> | null = null

function fetchRouted() {
  routedPromise ??= fetch('/api/providers', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d.routed === 'object' ? (d.routed as Routed) : {}))
    .catch(() => ({}))
  return routedPromise
}

/** Settings changed the routing: ask again next time. */
export function invalidateRoutedProviders() {
  routedPromise = null
}

export function useRoutedProviders(): Routed {
  const [routed, setRouted] = useState<Routed>({})
  useEffect(() => {
    let cancelled = false
    fetchRouted().then((r) => { if (!cancelled) setRouted(r) })
    return () => { cancelled = true }
  }, [])
  return routed
}
