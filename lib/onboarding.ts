// First-run state for the interactive onboarding tours. Pure UI state — stored
// in localStorage (single-user app, so "first time" is per-browser), mirroring
// the lib/connector-animation.ts convention with SSR-safe `typeof window` guards.
//
// There are three per-surface tours; each auto-opens once on first visit unless
// the user has opted out. The `?tour=<surface>` query param always launches a
// tour regardless of these flags (used for replay + clean promo capture).

export type TourSurface = 'dashboard' | 'canvas' | 'flow' | 'settings'

const SEEN_KEY: Record<TourSurface, string> = {
  dashboard: 'spite_tour_dashboard',
  canvas: 'spite_tour_canvas',
  flow: 'spite_tour_flow',
  settings: 'spite_tour_settings',
}
const OPTOUT_KEY = 'spite_tour_optout'

export function hasSeenTour(surface: TourSurface): boolean {
  if (typeof window === 'undefined') return true // never auto-open during SSR
  return window.localStorage.getItem(SEEN_KEY[surface]) === 'true'
}

export function markTourSeen(surface: TourSurface): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SEEN_KEY[surface], 'true')
}

export function isOptedOut(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(OPTOUT_KEY) === 'true'
}

export function setOptedOut(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(OPTOUT_KEY, 'true')
}

// Re-arm every tour (used by the "Replay tour" affordance).
export function resetTours(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(OPTOUT_KEY)
  ;(Object.keys(SEEN_KEY) as TourSurface[]).forEach((s) => window.localStorage.removeItem(SEEN_KEY[s]))
}

// `?tour=dashboard|canvas|flow` forces that tour open, bypassing the flags.
export function forcedTourFromUrl(): TourSurface | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('tour')
  return v === 'dashboard' || v === 'canvas' || v === 'flow' || v === 'settings' ? v : null
}

// Replay: a "?" / help affordance dispatches this so the mounted OnboardingTour
// for the current surface re-opens without a navigation.
export const START_TOUR_EVENT = 'spite:start-tour'
export function startTour(surface: TourSurface): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT, { detail: surface }))
}
