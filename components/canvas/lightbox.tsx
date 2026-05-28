'use client'

import { useEffect } from 'react'
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center text-white/90 transition-colors"
        aria-label="Close"
      >
        <X size={18} weight="bold" />
      </button>

      <div
        className="max-w-[92vw] max-h-[92vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <img
            src={url}
            alt="Preview"
            className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl"
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}
