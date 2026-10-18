'use client'

import { useEffect, useState } from 'react'

// Which models the server will route somewhere other than fal (today:
// Seedance 2.0 / 2.5 → BytePlus, when a key is configured). The browser can't
// see server env vars, so it asks once per page load. Until the answer
// arrives, estimates use fal's price — the higher of the two.

let routedPromise: Promise<Record<string, string>> | null = null

function fetchRouted() {
  routedPromise ??= fetch('/api/providers')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && typeof d.routed === 'object' ? (d.routed as Record<string, string>) : {}))
    .catch(() => ({}))
  return routedPromise
}

export function useRoutedProviders(): Record<string, string> {
  const [routed, setRouted] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    fetchRouted().then((r) => { if (!cancelled) setRouted(r) })
    return () => { cancelled = true }
  }, [])
  return routed
}
