'use client'

import { Copy, Crosshair } from '@phosphor-icons/react'

interface BottomBarProps {
  page: number
  zoom: number
  onRecenter: () => void
}

export function BottomBar({ page, zoom, onRecenter }: BottomBarProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-3 z-20">
      {/* Left - Page indicator */}
      <div className="glass flex items-center gap-2 px-2.5 py-1.5 rounded-lg">
        <Copy size={12} weight="thin" className="text-muted-foreground" />
        <span className="text-[11px] font-mono text-muted-foreground tracking-wide">
          Page {page}
        </span>
      </div>

      {/* Center - Recenter */}
      <button
        onClick={onRecenter}
        className="glass flex items-center gap-2 px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
      >
        <Crosshair size={12} weight="thin" />
        <span className="text-[11px] font-mono tracking-wide">Recenter</span>
      </button>

      {/* Right - Zoom */}
      <div className="glass flex items-center gap-2 px-2.5 py-1.5 rounded-lg">
        <span className="text-[11px] font-mono text-muted-foreground tracking-wide">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  )
}
