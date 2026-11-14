'use client'

import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

// Tallest the list gets, in its own (unzoomed) pixels, and the rough height of
// one row, used to size short lists before they render.
const LIST_MAX = 380
const ROW = 26
// Screen pixels kept clear between the list and the window edge.
const EDGE_GAP = 12

/**
 * The settings pickers on image and video nodes (model, size, quality...).
 *
 * The controls sit at the bottom of a node, so the list opens upward. Near the
 * top of the window that pushed the first entries off-screen, where no amount
 * of scrolling the list could reach them — on the video node that was the
 * Seedance models. So on open it measures the room above and below, flips
 * down when that fits better, and shortens itself to what's visible.
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
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState({ up: true, maxHeight: LIST_MAX })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggle = () => {
    if (disabled) return
    if (!open && ref.current) {
      const box = ref.current.getBoundingClientRect()
      // The canvas zoom scales everything inside a node, so convert the room
      // on screen into the list's own pixels.
      const zoom = box.height / (ref.current.offsetHeight || box.height) || 1
      const above = (box.top - EDGE_GAP) / zoom
      const below = (window.innerHeight - box.bottom - EDGE_GAP) / zoom
      const wanted = Math.min(LIST_MAX, options.length * ROW + 8)
      const up = above >= wanted || (below < wanted && above >= below)
      setPlace({ up, maxHeight: Math.max(96, Math.min(LIST_MAX, up ? above : below)) })
    }
    setOpen(!open)
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
      {/* nowheel/nodrag: without them React Flow takes the wheel and zooms
          the canvas instead of scrolling this list. */}
      {open && (
        <div
          className={`nowheel nodrag absolute left-0 ${place.up ? 'bottom-full mb-1' : 'top-full mt-1'} bg-[#1a1d21] border border-white/10 rounded-lg py-1 z-50 min-w-[120px] shadow-xl overflow-y-auto`}
          style={{ maxHeight: place.maxHeight }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/10 transition-colors ${opt.value === value ? 'text-accent' : 'text-muted-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
