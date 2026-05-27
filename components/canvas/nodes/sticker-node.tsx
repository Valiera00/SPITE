'use client'

import { useState, useEffect, useCallback } from 'react'
import { NodeProps } from '@xyflow/react'

const LAST_STICKER_KEY = 'canvas_last_sticker'

export const getLastSticker = () =>
  typeof window !== 'undefined'
    ? (localStorage.getItem(LAST_STICKER_KEY) || '⭐')
    : '⭐'

const saveLastSticker = (s: string) =>
  localStorage.setItem(LAST_STICKER_KEY, s)

const STICKER_ROWS = [
  ['⭐', '🔥', '💡', '✅', '❌', '❤️'],
  ['🎯', '🚀', '⚡', '📌', '🎬', '👍'],
  ['💬', '❓', '🎨', '💎', '✨', '👎'],
]

export function StickerNode({ data, selected }: NodeProps) {
  const [sticker, setSticker] = useState(
    (data.sticker as string) || getLastSticker()
  )
  const [showPicker, setShowPicker] = useState(false)

  // Close picker when clicking outside or when the canvas pane is clicked
  useEffect(() => {
    const handler = () => setShowPicker(false)
    window.addEventListener('closeStickerPickers', handler)
    return () => window.removeEventListener('closeStickerPickers', handler)
  }, [])

  const pick = useCallback((s: string) => {
    setSticker(s)
    saveLastSticker(s)
    setShowPicker(false)
  }, [])

  return (
    <div className="relative">
      <div
        onClick={(e) => {
          e.stopPropagation()
          setShowPicker(v => !v)
        }}
        className="cursor-pointer select-none transition-transform hover:scale-110 active:scale-95"
        style={{
          fontSize: 36,
          lineHeight: 1,
          filter: selected ? 'drop-shadow(0 0 10px rgba(168,85,247,0.6))' : 'none',
        }}
      >
        {sticker}
      </div>

      {showPicker && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-1.5 rounded-xl z-50 nodrag nopan"
          style={{
            background: 'rgba(20,22,28,0.98)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {STICKER_ROWS.map((row, ri) => (
            <div key={ri} className="flex gap-0.5 mb-0.5 last:mb-0">
              {row.map((s) => (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); pick(s) }}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg text-base transition-colors ${
                    s === sticker ? 'bg-white/15' : 'hover:bg-white/10'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
