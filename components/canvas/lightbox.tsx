'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

interface LightboxProps {
  open: boolean
  url: string | null | undefined
  type: 'image' | 'video'
  onClose: () => void
}

// Full-screen preview overlay for image/video node outputs. Click outside
// the media or press Escape to close.
export function Lightbox({ open, url, type, onClose }: LightboxProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || !url) return null
  if (typeof document === 'undefined') return null

  // Render to document.body so the overlay isn't trapped inside React Flow's
  // transformed pane (which would make position:fixed scope to that pane
  // instead of the viewport — letting the user pan the canvas underneath).
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center cursor-zoom-out backdrop-blur-md"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors z-10"
        aria-label="Close"
      >
        <X size={14} weight="bold" />
      </button>

      {/* Wrapper fixes the viewport size so the media inside fills it via
          object-contain — without this, a small natural-resolution video
          would render at its intrinsic size instead of expanding. */}
      <div
        className="flex items-center justify-center"
        style={{ width: '95vw', height: '95vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            controlsList="nofullscreen"
            onDoubleClick={(e) => e.preventDefault()}
            className="w-full h-full object-contain cursor-default"
          />
        ) : (
          <img
            src={url}
            alt="Preview"
            className="w-full h-full object-contain cursor-default"
            draggable={false}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
