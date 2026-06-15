'use client'

import { SpeakerHigh } from '@phosphor-icons/react'

// Renders the visual body of an asset (image / video / audio) — used
// by the asset panel grid, the expanded asset preview, the lightbox,
// the folder browser, and the mention picker. Before this existed,
// every call site duplicated the same `type === 'video' ? <video> :
// type === 'audio' ? <amber-gradient + icon> : <img>` switch with
// slightly different fit/size combinations.
//
// Two display modes:
//   variant='grid'    (default) — muted silent video, audio shows
//                                 just the speaker icon on the amber
//                                 gradient. Used in any grid tile.
//   variant='preview' — video with native <video controls>, audio with
//                       a full HTML5 <audio controls> player below the
//                       icon. Used in the expanded preview pane and
//                       the lightbox.
//
// The badge layer (top-left media-type chip + the
// used_in_canvas/recovered chips) stays in the caller because each
// caller mixes media-type badges with caller-specific badges in the
// same absolutely-positioned strip.
interface AssetThumbProps {
  url: string
  type: 'image' | 'video' | 'audio'
  variant?: 'grid' | 'preview'
  // object-fit for video. Defaults to cover; the metadata preview pane
  // uses contain to letterbox the full frame.
  fit?: 'cover' | 'contain'
  // Size of the centred SpeakerHigh icon when displaying an audio asset
  // in grid mode. Different tile sizes pick different values
  // (20 for compact folder tiles, 24 for the extended view, 32 for
  // standard grid). Ignored for preview variant (always 48).
  audioIconSize?: number
}

export function AssetThumb({
  url,
  type,
  variant = 'grid',
  fit = 'cover',
  audioIconSize = 32,
}: AssetThumbProps) {
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover'

  if (type === 'video') {
    return variant === 'preview' ? (
      <video
        src={url}
        controls
        preload="metadata"
        className={`w-full h-full ${fitClass}`}
      />
    ) : (
      <video
        src={url}
        muted
        preload="metadata"
        draggable={false}
        className="w-full h-full object-cover"
      />
    )
  }

  if (type === 'audio') {
    return variant === 'preview' ? (
      <div className="w-full h-full bg-gradient-to-br from-amber-950/40 to-zinc-900 flex flex-col items-center justify-center gap-4 px-4">
        <SpeakerHigh size={48} weight="duotone" className="text-amber-400/70" />
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full max-w-xs"
        />
      </div>
    ) : (
      <div className="w-full h-full bg-gradient-to-br from-amber-950/40 to-zinc-900 flex items-center justify-center">
        <SpeakerHigh
          size={audioIconSize}
          weight="duotone"
          className="text-amber-400/70"
        />
      </div>
    )
  }

  // Default: image. Lazy + async-decoded so the asset panel can scroll
  // a few hundred thumbnails without saturating the main thread.
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      // Not independently draggable — let the draggable tile own the drag so
      // the 'asset' payload reaches the canvas. Since the r2-image proxy now
      // 302s to cross-origin R2, a native image drag here gets blocked by the
      // browser and the tile drag silently failed.
      draggable={false}
      className="w-full h-full object-cover"
    />
  )
}
