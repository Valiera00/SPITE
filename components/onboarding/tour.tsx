'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import type { TourStep } from './steps'

export type TourCloseReason = 'done' | 'skip' | 'optout'

const PAD = 8 // breathing room around the spotlighted element
const POPOVER_W = 440

// Choose where the popover sits relative to the highlighted rect (or center it
// when there's no target). Anchors by `bottom`/`right` for the above/left cases
// so we don't need to know the popover's height in advance.
function popoverStyle(rect: DOMRect | null): React.CSSProperties {
  if (typeof window === 'undefined' || !rect) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: POPOVER_W }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - POPOVER_W - 12))
  const below = vh - rect.bottom
  const above = rect.top
  if (below >= 240 || below >= above) {
    return { top: rect.bottom + 12 + PAD, left: clampX(rect.left + rect.width / 2 - POPOVER_W / 2), width: POPOVER_W }
  }
  return { bottom: vh - rect.top + 12 + PAD, left: clampX(rect.left + rect.width / 2 - POPOVER_W / 2), width: POPOVER_W }
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: (reason: TourCloseReason) => void }) {
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)
  const settleTimer = useRef<number | null>(null)
  const step = steps[idx]
  const last = idx === steps.length - 1

  useEffect(() => { setMounted(true) }, [])

  // Per-step side effects (e.g. open the assets panel). onEnter on arrival,
  // onLeave on departure / close.
  useEffect(() => {
    const s = steps[idx]
    s?.onEnter?.()
    return () => s?.onLeave?.()
  }, [idx, steps])

  const measure = useCallback(() => {
    const el = step?.target ? document.querySelector<HTMLElement>(step.target) : null
    setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null)
  }, [step])

  // On step change: bring the target into view, then measure (twice — once now,
  // once after the scroll settles).
  useEffect(() => {
    const el = step?.target ? document.querySelector<HTMLElement>(step.target) : null
    if (el) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: reduce ? 'auto' : 'smooth' })
    }
    measure()
    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    // A couple of re-measures so panels opened by onEnter settle before we lock on.
    const t2 = window.setTimeout(measure, 240)
    settleTimer.current = window.setTimeout(measure, 560)
    return () => { window.clearTimeout(t2); if (settleTimer.current) window.clearTimeout(settleTimer.current) }
  }, [idx, step, measure])

  // Stay aligned through scroll / resize.
  useEffect(() => {
    let raf = 0
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => { window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); cancelAnimationFrame(raf) }
  }, [measure])

  const next = useCallback(() => { if (last) onClose('done'); else setIdx((i) => i + 1) }, [last, onClose])
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), [])

  // Keyboard: Esc skips, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose('skip')
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  if (!mounted || !step) return null

  const ring = rect
    ? {
        position: 'fixed' as const,
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
        borderRadius: 14,
        boxShadow: '0 0 0 9999px rgba(8,10,12,0.74), 0 0 0 1.5px rgba(174,195,210,0.55), 0 0 22px 2px rgba(190,210,228,0.35)',
        pointerEvents: 'none' as const,
        transition: 'all 0.18s ease',
      }
    : null

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Click-catcher. With a target, the ring's boxShadow provides the dim, so
          this stays transparent; with no target we dim it directly. */}
      <div
        className="absolute inset-0 pointer-events-auto"
        style={{ background: rect ? 'transparent' : 'rgba(8,10,12,0.74)' }}
        onClick={() => { /* swallow clicks; don't dismiss on backdrop */ }}
      />
      {ring && <div style={ring} />}

      <div
        className="absolute pointer-events-auto glass rounded-2xl border border-white/10 shadow-[0_16px_50px_rgba(0,0,0,0.6)] p-5 flex flex-col gap-3.5 text-[#F0EDE6]"
        style={{ ...popoverStyle(rect), maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}
      >
        <button onClick={() => onClose('skip')} aria-label="Close tour"
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition"><X size={14} /></button>

        {step.video ? (
          <video src={step.video} autoPlay muted loop playsInline onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = 'none' }}
            className="w-full rounded-xl border border-white/10 object-cover max-h-72 bg-black/30" />
        ) : step.image ? (
          <img src={step.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }}
            className="w-full rounded-xl border border-white/10 object-cover max-h-72 bg-black/30" />
        ) : null}

        <div className="flex flex-col gap-2 pr-6">
          <h3 className="text-[17px] font-semibold tracking-tight" style={{ fontFamily: 'var(--font-montserrat)' }}>{step.title}</h3>
          <p className="text-[13.5px] leading-relaxed text-foreground/80">{step.body}</p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-4 bg-accent' : 'w-1.5 bg-white/20'}`} />
          ))}
          <span className="ml-auto text-[10px] font-mono text-muted-foreground/50">{idx + 1}/{steps.length}</span>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <button onClick={() => onClose('optout')} className="text-[10px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition">Don’t show again</button>
          <div className="ml-auto flex items-center gap-1.5">
            {idx > 0 && (
              <button onClick={prev} className="flex items-center gap-1 px-2.5 h-8 rounded-full bg-white/[0.06] hover:bg-white/10 text-[12px] font-mono text-foreground/80 transition"><CaretLeft size={12} /> Back</button>
            )}
            <button onClick={next} className="flex items-center gap-1 px-3.5 h-8 rounded-full bg-accent text-[#0D0F12] text-[12px] font-mono font-medium active:scale-95 transition">
              {last ? 'Done' : <>Next <CaretRight size={12} weight="bold" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
