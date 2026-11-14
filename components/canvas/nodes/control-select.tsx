'use client'

import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Tallest the list gets, in its own (unzoomed) pixels, and the rough height of
// one row, used to size short lists before they render.
const LIST_MAX = 380
const ROW = 26
// Screen pixels kept clear between the list and the window edge.
const EDGE_GAP = 12

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number; zoom: number; up: boolean }

/**
 * The settings pickers on image and video nodes (model, size, quality...).
 *
 * The list is rendered on top of the page rather than inside the node: the
 * node card clips its contents, and a list opening upward from the controls at
 * the bottom of the node lost its first entries under the node's top edge —
 * on the video node that was the Seedance models. It opens upward, flips down
 * when there's more room below, shortens to fit the window, and keeps the
 * canvas zoom so it still looks attached to the node.
 */
export function ControlSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [place, setPlace] = useState<Placement | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const open = place !== null

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (ref.current?.contains(t) || listRef.current?.contains(t))
    const onMouseDown = (e: MouseEvent) => { if (!inside(e.target)) setPlace(null) }
    // The list doesn't follow the canvas, so close it when the canvas moves.
    const onWheel = (e: WheelEvent) => { if (!inside(e.target)) setPlace(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlace(null) }
    const close = () => setPlace(null)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (disabled) return
    if (open || !ref.current) { setPlace(null); return }
    const box = ref.current.getBoundingClientRect()
    // Canvas zoom: on-screen size of the button over its own size.
    const zoom = box.height / (ref.current.offsetHeight || box.height) || 1
    const above = box.top - EDGE_GAP
    const below = window.innerHeight - box.bottom - EDGE_GAP
    const wanted = Math.min(LIST_MAX, options.length * ROW + 8) * zoom
    const up = above >= wanted || (below < wanted && above >= below)
    const room = up ? above : below
    setPlace({
      left: box.left,
      ...(up ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
      maxHeight: Math.max(96, Math.min(LIST_MAX, room / zoom)),
      zoom,
      up,
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        disabled={disabled}
        className="flex items-center gap-1 px-2 h-6 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-mono text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {value}
        <CaretDown size={8} weight="bold" />
      </button>
      {place && createPortal(
        <div
          ref={listRef}
          className="nowheel nodrag fixed z-[1000] bg-[#1a1d21] border border-white/10 rounded-lg py-1 w-max min-w-[120px] max-w-[240px] shadow-xl overflow-y-auto"
          style={{
            left: place.left,
            top: place.top,
            bottom: place.bottom,
            maxHeight: place.maxHeight,
            transform: `scale(${place.zoom})`,
            transformOrigin: place.up ? 'bottom left' : 'top left',
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setPlace(null) }}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/10 transition-colors ${opt.value === value ? 'text-accent' : 'text-muted-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
