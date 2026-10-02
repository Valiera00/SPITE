'use client'

import { useEffect, useRef, useState } from 'react'
import { SpeakerHigh } from '@phosphor-icons/react'
import { thumbUrl } from '@/lib/asset-url'

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
      <LazyGridVideo url={url} />
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
  // a few hundred thumbnails without saturating the main thread. Grid tiles
  // load the small WebP rendition; the preview pane keeps the original.
  if (variant === 'grid') return <GridImage url={url} />
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="w-full h-full object-cover"
    />
  )
}

// Grid tile image. Loads the ~30KB thumbnail rendition instead of the
// original; if that request fails for any reason (a format the thumbnailer
// can't decode, a transient error) it falls back to the original once, so a
// thumbnail problem never shows up as a broken tile.
function GridImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const small = thumbUrl(url)
  return (
    <img
      src={failed ? url : small}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => { if (!failed && small !== url) setFailed(true) }}
      // Not independently draggable, and pointer-events-none so the drag
      // gesture passes through to the draggable tile. The r2-image proxy 302s
      // originals to cross-origin R2, so a native image drag here is blocked by
      // the browser and a draggable="false" child won't bubble the drag up —
      // letting the gesture fall through to the tile is what makes drag work.
      draggable={false}
      className="w-full h-full object-cover pointer-events-none"
    />
  )
}

// Grid tile video. A <video preload="metadata"> opens a connection and pulls
// the header + first frame the moment it mounts, lazy-loading doesn't exist
// for <video>, and a library can hold dozens of clips — so every one of them
// used to start loading at once, on-screen or not. Mount the element only
// when its tile is about to scroll into view; once mounted it stays, so
// scrolling back doesn't reload it.
function LazyGridVideo({ url }: { url: string }) {
  const holder = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (show) return
    const el = holder.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setShow(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { setShow(true); io.disconnect() }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [show])
  return (
    <div ref={holder} className="w-full h-full bg-black/40 pointer-events-none">
      {show && (
        <video
          src={url}
          muted
          preload="metadata"
          draggable={false}
          // pointer-events-none so a drag gesture passes through to the draggable
          // tile instead of dying on the media element (Chrome won't bubble a
          // drag from a draggable="false" child up to the draggable parent).
          className="w-full h-full object-cover pointer-events-none"
        />
      )}
    </div>
  )
}
