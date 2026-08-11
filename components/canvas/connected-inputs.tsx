'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { X, LinkBreak, WarningCircle } from '@phosphor-icons/react'
import { resolveNodeMediaUrl } from '@/lib/node-media'

// A small count badge pinned just outside a media input handle. Click it to see
// exactly what's wired into that input — thumbnails of each connected source —
// and detach any one of them with its X, without hunting across the board for
// the right cord.
//
// Why a badge next to the handle rather than the handle itself: the visible
// HandleIcon sits directly on top of React Flow's invisible <Handle> and is
// pointer-events:none so drags pass through. Making it clickable would swallow
// mousedown and break dragging a new connection from that port. The badge sits
// clear of the handle's hit box, so both gestures keep working.

interface Props {
  nodeId: string
  handleId: string
  /** Which side of the node the handle is on. */
  side: 'left' | 'right'
  /** Same `top` value passed to the handle, so the badge lines up with it. */
  top: number
  label?: string
}

export function ConnectedInputs({ nodeId, handleId, side, top, label = 'Connected' }: Props) {
  const { getEdges, getNodes, setEdges } = useReactFlow()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Subscribe to just this handle's edges, reduced to a compact string so the
  // badge re-renders only when THIS input's connections actually change —
  // not on every edge mutation anywhere on the canvas.
  const key = useStore(
    useCallback(
      (s: { edges: Array<{ id: string; target: string; targetHandle?: string | null; source: string }> }) =>
        s.edges
          .filter((e) => e.target === nodeId && e.targetHandle === handleId)
          .map((e) => `${e.id}:${e.source}`)
          .join(','),
      [nodeId, handleId],
    ),
  )

  const edgeIds = key ? key.split(',') : []
  const count = edgeIds.length

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => { if (count === 0) setOpen(false) }, [count])

  if (count === 0) return null

  // Resolve the live items only while the popover is open — no work otherwise.
  const items = open
    ? getEdges()
        .filter((e) => e.target === nodeId && e.targetHandle === handleId)
        .map((e) => {
          const src = getNodes().find((n) => n.id === e.source)
          return {
            edgeId: e.id,
            sourceId: e.source,
            url: resolveNodeMediaUrl(src?.data as Record<string, unknown>),
            title: (src?.data?.prompt as string) || (src?.data?.text as string) || (src?.type as string) || 'Source',
          }
        })
    : []

  const disconnect = (edgeId: string) => setEdges((es) => es.filter((e) => e.id !== edgeId))

  const anyDead = items.some((i) => !i.url)

  return (
    <div
      ref={ref}
      className="nodrag nopan absolute"
      style={{
        top,
        [side === 'left' ? 'left' : 'right']: -34,
        transform: 'translateY(-50%)',
        zIndex: 12,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title={`${count} connected — click to inspect`}
        aria-label={`${count} connected input${count === 1 ? '' : 's'}`}
        className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-mono leading-none transition-colors ${
          open ? 'bg-accent text-[#0D0F12]' : 'bg-[#1a1d21] text-foreground/70 border border-white/20 hover:border-accent/60 hover:text-foreground'
        }`}
      >
        {count}
      </button>

      {open && (
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#141719] shadow-[0_10px_40px_rgba(0,0,0,0.6)] p-2 w-[188px]"
          style={{ [side === 'left' ? 'right' : 'left']: 24 }}
        >
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">{label} · {count}</span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X size={9} weight="bold" /></button>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-[190px] overflow-y-auto">
            {items.map((it) => (
              <div key={it.edgeId} className="relative group" title={it.title}>
                {it.url ? (
                  <img
                    src={it.url}
                    alt=""
                    className="w-[52px] h-[52px] rounded-md object-cover border border-white/10 bg-black/40"
                    draggable={false}
                  />
                ) : (
                  // Attached but delivering nothing — the source hasn't generated
                  // or uploaded yet. Flagged so it's obvious why a reference is
                  // "missing" from the result.
                  <div className="w-[52px] h-[52px] rounded-md border border-dashed border-amber-400/40 bg-amber-400/5 flex items-center justify-center" title="No image yet — this input would be ignored">
                    <WarningCircle size={14} className="text-amber-400/80" />
                  </div>
                )}
                <button
                  onClick={() => disconnect(it.edgeId)}
                  aria-label="Disconnect this input"
                  title="Disconnect"
                  className="absolute -top-1 -right-1 w-[15px] h-[15px] rounded-full bg-black/90 border border-white/30 flex items-center justify-center text-foreground/80 hover:bg-red-500 hover:text-white hover:border-red-400 transition-colors"
                >
                  <X size={8} weight="bold" />
                </button>
              </div>
            ))}
          </div>

          {anyDead && (
            <p className="text-[9px] font-mono text-amber-400/80 leading-snug px-1 pt-1.5">
              Amber = source has no image yet; it would be ignored.
            </p>
          )}

          {count > 1 && (
            <button
              onClick={() => { setEdges((es) => es.filter((e) => !(e.target === nodeId && e.targetHandle === handleId))); setOpen(false) }}
              className="mt-1.5 w-full flex items-center justify-center gap-1 h-6 rounded-md bg-white/5 hover:bg-red-500/15 hover:text-red-300 text-[9px] font-mono text-muted-foreground transition-colors"
            >
              <LinkBreak size={9} /> Disconnect all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
