'use client'

import { useEffect, useState } from 'react'
import { Tour, type TourCloseReason } from './tour'
import { TOURS } from './steps'
import {
  forcedTourFromUrl, hasSeenTour, isOptedOut, markTourSeen, setOptedOut,
  START_TOUR_EVENT, type TourSurface,
} from '@/lib/onboarding'

// Drop <OnboardingTour surface="dashboard" /> onto a surface. It auto-opens once
// on first visit (unless opted out), opens immediately when `?tour=<surface>` is
// present, and re-opens whenever startTour(surface) is dispatched (the replay
// button). A short delay lets the page's anchors mount before measuring.
export function OnboardingTour({ surface, delayMs = 550 }: { surface: TourSurface; delayMs?: number }) {
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState(0) // bump to remount the Tour fresh

  useEffect(() => {
    const forced = forcedTourFromUrl() === surface
    let t: number | undefined
    if (forced) {
      // Strip ?tour so a refresh doesn't reloop.
      const url = new URL(window.location.href)
      url.searchParams.delete('tour')
      window.history.replaceState({}, '', url.toString())
      setOpen(true)
    } else if (!hasSeenTour(surface) && !isOptedOut()) {
      t = window.setTimeout(() => setOpen(true), delayMs)
    }
    const onStart = (e: Event) => {
      if ((e as CustomEvent).detail === surface) { setRun((n) => n + 1); setOpen(true) }
    }
    window.addEventListener(START_TOUR_EVENT, onStart)
    return () => { if (t) window.clearTimeout(t); window.removeEventListener(START_TOUR_EVENT, onStart) }
  }, [surface, delayMs])

  if (!open) return null

  const handleClose = (reason: TourCloseReason) => {
    setOpen(false)
    if (reason === 'optout') setOptedOut()
    markTourSeen(surface)
  }
  return <Tour key={run} steps={TOURS[surface]} onClose={handleClose} />
}
