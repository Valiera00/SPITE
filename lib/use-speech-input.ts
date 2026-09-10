'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Dictation via the browser's built-in Web Speech API.
//
// Free, no key, no server round-trip, nothing added to the spend gate — the
// recognizer ships with the browser. Chrome/Edge/Safari have it; Firefox does
// not, so `supported` is false there and every mic button unmounts itself
// rather than rendering something that can't work.
//
// PRIVACY: Chrome streams the captured audio to Google's servers to transcribe
// it (Safari uses Apple's). That's a third party the rest of this app never
// talks to, so any button wired to this hook must say so — see MicButton's
// title text. Nothing is recorded, uploaded to R2, or persisted by us: the
// transcript arrives as a string and goes straight into the prompt box.
// ---------------------------------------------------------------------------

// The Web Speech API isn't in TypeScript's DOM lib, and the shape differs
// slightly between vendors, so we describe only the parts we touch.
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechResultEvent {
  resultIndex: number
  results: {
    length: number
    [i: number]: { isFinal: boolean; 0: { transcript: string } }
  }
}

type Ctor = new () => SpeechRecognitionLike

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as Ctor | null
}

// Only one recognizer may hold the mic at a time. The canvas can show many
// prompt boxes at once, and starting a second session while the first is live
// makes Chrome throw and leaves both in a broken state — so starting anywhere
// stops whatever was already running. Identity is a per-hook token object
// rather than the stop function itself, which keeps this free of the
// declared-later-than-used tangle.
let activeToken: object | null = null
let activeStop: (() => void) | null = null

export interface SpeechInput {
  /** False on Firefox and during SSR — render no mic button at all. */
  supported: boolean
  listening: boolean
  /** Words recognized but not yet finalized. For live feedback only. */
  interim: string
  /** Human-readable failure, or null. Clears on the next successful start. */
  error: string | null
  start: () => void
  stop: () => void
  toggle: () => void
}

/**
 * @param onText Called with each finalized phrase. Fires repeatedly during a
 *   single session (Chrome finalizes on every natural pause), so append —
 *   never replace. Kept in a ref internally, so an inline arrow is fine.
 */
export function useSpeechInput(onText: (text: string) => void): SpeechInput {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Stable per-hook identity for the single-mic registry above.
  const tokenRef = useRef<object>({})
  // Whether the USER still wants to listen. Chrome ends a session on its own
  // after a few seconds of silence even with continuous=true, so onend
  // consults this to decide between restarting and going idle.
  const wantRef = useRef(false)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  // Restart-loop guard: if the recognizer keeps ending immediately (no mic,
  // permission revoked mid-session), stop rather than spinning forever.
  const restartsRef = useRef(0)
  const restartWindowRef = useRef(0)

  useEffect(() => {
    setSupported(!!getCtor())
  }, [])

  const releaseRegistry = useCallback(() => {
    if (activeToken === tokenRef.current) {
      activeToken = null
      activeStop = null
    }
  }, [])

  const stop = useCallback(() => {
    wantRef.current = false
    setInterim('')
    setListening(false)
    releaseRegistry()
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped — nothing to do */
    }
  }, [releaseRegistry])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    // Take the mic from whoever else had it.
    if (activeStop && activeToken !== tokenRef.current) activeStop()

    setError(null)
    restartsRef.current = 0
    restartWindowRef.current = Date.now()

    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let finalChunk = ''
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript ?? ''
        if (r.isFinal) finalChunk += t
        else pending += t
      }
      setInterim(pending.trim())
      const clean = finalChunk.trim()
      if (clean) {
        // A finalized phrase resets the loop guard: real speech is arriving,
        // so any earlier rapid restarts weren't a broken-mic spiral.
        restartsRef.current = 0
        onTextRef.current(clean)
      }
    }

    rec.onerror = (e) => {
      switch (e.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          setError('Microphone blocked — allow mic access for this site in your browser.')
          wantRef.current = false
          break
        case 'audio-capture':
          setError('No microphone found.')
          wantRef.current = false
          break
        case 'network':
          setError('Speech service unreachable — check your connection.')
          wantRef.current = false
          break
        // 'no-speech' fires after a quiet stretch and 'aborted' fires when we
        // stop on purpose. Neither is worth showing.
        case 'no-speech':
        case 'aborted':
          break
        default:
          setError(`Dictation failed (${e.error}).`)
          wantRef.current = false
      }
    }

    rec.onend = () => {
      if (!wantRef.current) {
        setListening(false)
        setInterim('')
        releaseRegistry()
        return
      }
      // Ended on its own but the user is still holding the session open.
      // Restart, unless it's ending instantly over and over.
      const now = Date.now()
      if (now - restartWindowRef.current > 10_000) {
        restartsRef.current = 0
        restartWindowRef.current = now
      }
      restartsRef.current += 1
      if (restartsRef.current > 6) {
        wantRef.current = false
        setListening(false)
        setInterim('')
        setError('Dictation kept dropping out — try again.')
        releaseRegistry()
        return
      }
      try {
        rec.start()
      } catch {
        wantRef.current = false
        setListening(false)
        releaseRegistry()
      }
    }

    recRef.current = rec
    wantRef.current = true
    activeToken = tokenRef.current
    activeStop = stop
    try {
      rec.start()
      setListening(true)
    } catch {
      // start() throws if a session is somehow already running on this
      // instance; treat it as already-listening rather than erroring out.
      setListening(true)
    }
  }, [releaseRegistry, stop])

  const toggle = useCallback(() => {
    if (wantRef.current) stop()
    else start()
  }, [start, stop])

  // Release the mic if the prompt box unmounts mid-session.
  useEffect(() => {
    const token = tokenRef.current
    const rec = recRef
    return () => {
      wantRef.current = false
      if (activeToken === token) {
        activeToken = null
        activeStop = null
      }
      try {
        rec.current?.abort()
      } catch {
        /* nothing to release */
      }
    }
  }, [])

  return { supported, listening, interim, error, start, stop, toggle }
}

/**
 * Join dictated text onto whatever is already in the box, adding the space
 * the recognizer doesn't supply. Skips the space after an open bracket or an
 * existing trailing space so we don't double up.
 */
export function appendDictated(existing: string, chunk: string): string {
  if (!existing) return chunk
  if (/[\s([{]$/.test(existing)) return existing + chunk
  return existing + ' ' + chunk
}
