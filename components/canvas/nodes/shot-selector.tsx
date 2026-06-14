'use client'

import { useState, useRef, useEffect } from 'react'
import { CaretDown, Check, Plus, FilmStrip, Image as ImageIcon, X, ArrowsClockwise } from '@phosphor-icons/react'

export interface ShotOption {
  id: string
  label: string
  thumbnail?: string
  hasVideo?: boolean
}

interface ShotSelectorProps {
  selectedShotId?: string
  shots: ShotOption[]
  // Pass an empty string to unassign the node from its current shot.
  onSelect: (shotId: string) => void
  onNewShot: () => void
  // Take a shot over EXCLUSIVELY: assign it to this node and unassign whatever
  // other node currently holds it. (Plain onSelect just adds this node as an
  // additional take.)
  onReplace?: (shotId: string) => void
}

export function ShotSelector({ selectedShotId, shots, onSelect, onNewShot, onReplace }: ShotSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedShot = shots.find(s => s.id === selectedShotId)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex items-center gap-1.5 h-6 px-2 rounded-md bg-[#1a1d21]/90 border border-white/10 hover:border-white/20 transition-colors"
      >
        <Check size={10} className="text-accent" />
        <span className="text-[10px] font-mono text-foreground/80">
          {selectedShot?.label || 'Select shot'}
        </span>
        <CaretDown size={8} className="text-muted-foreground" />
      </button>

      {open && (
        <div 
          className="absolute top-full left-0 mt-1 w-48 py-1.5 rounded-lg bg-[#1a1d21] border border-white/10 shadow-xl z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 mb-1">
            <span className="text-[9px] font-mono text-muted-foreground/60 uppercase tracking-wider">
              Select as a take for
            </span>
          </div>

          <div className="max-h-48 overflow-y-auto">
            {shots.map((shot) => {
              const isCurrent = selectedShotId === shot.id
              return (
                <div
                  key={shot.id}
                  className="group/shot w-full flex items-center hover:bg-white/5 transition-colors"
                >
                  <button
                    onClick={() => { onSelect(shot.id); setOpen(false) }}
                    className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5"
                  >
                    {/* Thumbnail */}
                    <div className="w-8 h-5 rounded overflow-hidden bg-black/40 shrink-0 flex items-center justify-center">
                      {shot.thumbnail ? (
                        <img src={shot.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : shot.hasVideo ? (
                        <FilmStrip size={10} className="text-muted-foreground/40" />
                      ) : (
                        <ImageIcon size={10} className="text-muted-foreground/40" />
                      )}
                    </div>
                    {/* Label */}
                    <span className="text-[11px] font-mono text-foreground/80 flex-1 text-left truncate">
                      {shot.label}
                    </span>
                    {/* Check if selected */}
                    {isCurrent && (
                      <Check size={12} className="text-accent shrink-0" />
                    )}
                  </button>
                  {/* Replace: take this shot over exclusively (unassigns the
                      node currently holding it). Hidden for the node's own shot. */}
                  {onReplace && !isCurrent && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onReplace(shot.id); setOpen(false) }}
                      title="Reassign this shot to this node, unassigning the current one"
                      className="opacity-0 group-hover/shot:opacity-100 shrink-0 flex items-center gap-1 mr-1.5 px-1.5 py-1 rounded text-[9px] font-mono text-accent hover:bg-accent/15 transition-all"
                    >
                      <ArrowsClockwise size={10} weight="bold" />
                      Replace
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="border-t border-white/5 mt-1 pt-1">
            <button
              onClick={() => { onNewShot(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors text-accent"
            >
              <Plus size={12} weight="bold" />
              <span className="text-[11px] font-mono">New Shot</span>
            </button>
            {selectedShotId && (
              <button
                onClick={() => { onSelect(''); setOpen(false) }}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
              >
                <X size={12} weight="bold" />
                <span className="text-[11px] font-mono">Remove from shot</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
