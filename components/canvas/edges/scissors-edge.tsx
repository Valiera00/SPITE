'use client'

import { useState, useMemo } from 'react'
import {
  EdgeLabelRenderer,
  useReactFlow,
  Position,
  type EdgeProps,
} from '@xyflow/react'
import { Scissors } from '@phosphor-icons/react'

// ---------------------------------------------------------------------------
// Braided "cord" edge — the landing-page manifesto connectors, in the canvas.
//
// Three strands woven along the curve with a soft glow and lit plugs, gently
// drifting like the original. States:
//   - IDLE (small canvas) → gentle always-on drift, dim, no blur (cheap).
//   - ACTIVE / HOVER       → bigger braid, brighter, soft blurred glow, pulsing
//                            plugs. "Active" = a connected node is selected.
//   - IDLE (big canvas)    → static soft cord, no animation, to protect FPS.
//
// Performance guardrails:
//   - Every cord animates only while the canvas has <= ANIM_BUDGET edges.
//     Past that, idle cords go static and only the ones you touch/select move.
//   - At most ANIM_CAP active cords animate at once (big multi-select falls
//     back to a bright static highlight).
//   - Blur (the expensive filter) is used ONLY on active/hovered cords, which
//     are always a small number.
// ---------------------------------------------------------------------------

// Canvases with at most this many edges animate every cord (the "alive" look).
// Above it, idle cords are static and only active/hovered ones move.
const ANIM_BUDGET = 26
// Max simultaneously-active cords we'll animate before falling back to static.
const ANIM_CAP = 10

interface XY { x: number; y: number }

function cubic(p0: XY, c1: XY, c2: XY, p1: XY, t: number): XY {
  const m = 1 - t
  return {
    x: m * m * m * p0.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p1.x,
    y: m * m * m * p0.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p1.y,
  }
}
function cubicTan(p0: XY, c1: XY, c2: XY, p1: XY, t: number): XY {
  const m = 1 - t
  return {
    x: 3 * m * m * (c1.x - p0.x) + 6 * m * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x),
    y: 3 * m * m * (c1.y - p0.y) + 6 * m * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y),
  }
}

const SAMPLES = 30

// One strand sampled along the bezier, sine-waved on the normal and enveloped
// so it tapers to zero at both ends (clean plug-in). amp = 0 → plain centerline.
function strand(
  p0: XY, c1: XY, c2: XY, p1: XY,
  amp: number, twists: number, phase: number,
): string {
  let d = ''
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const pt = cubic(p0, c1, c2, p1, t)
    if (amp === 0) {
      d += (i === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1)
      continue
    }
    const tn = cubicTan(p0, c1, c2, p1, t)
    const L = Math.hypot(tn.x, tn.y) || 1
    const nx = -tn.y / L
    const ny = tn.x / L
    const env = Math.sin(Math.PI * t)
    const off = amp * env * Math.sin(twists * Math.PI * 2 * t + phase)
    d += (i === 0 ? 'M' : 'L') + (pt.x + nx * off).toFixed(1) + ' ' + (pt.y + ny * off).toFixed(1)
  }
  return d
}

// Morph targets for the living twist: the strand at phases swept through a
// full turn so SMIL cycles them into a continuous drift.
function variants(
  p0: XY, c1: XY, c2: XY, p1: XY,
  amp: number, twists: number, phase0: number,
): string {
  const K = 7
  const v: string[] = []
  for (let k = 0; k <= K; k++) {
    v.push(strand(p0, c1, c2, p1, amp, twists, phase0 + (k / K) * Math.PI * 2))
  }
  return v.join(';')
}

function normalFor(pos: Position | undefined): XY {
  switch (pos) {
    case Position.Left: return { x: -1, y: 0 }
    case Position.Right: return { x: 1, y: 0 }
    case Position.Top: return { x: 0, y: -1 }
    case Position.Bottom: return { x: 0, y: 1 }
    default: return { x: 1, y: 0 }
  }
}

// An animated strand. `blurPx` adds the soft glow halo (used only on the few
// active/hovered cords). The initial `d` is the first morph target so there's
// no flash before SMIL starts.
function LiveStrand({
  values, dur, width, color, opacity, blurPx, glow,
}: {
  values: string
  dur: number
  width: number
  color: string
  opacity: number
  blurPx?: number
  glow?: boolean
}) {
  const first = values.split(';')[0]
  const filter = blurPx
    ? `blur(${blurPx}px)`
    : glow
      ? 'drop-shadow(0 0 2.5px rgba(190,210,228,0.7))'
      : undefined
  return (
    <path
      d={first}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={opacity}
      style={filter ? { filter } : undefined}
    >
      <animate
        attributeName="d"
        dur={`${dur}s`}
        repeatCount="indefinite"
        calcMode="linear"
        values={values}
      />
    </path>
  )
}

export function ScissorsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  selected,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const { setEdges, getEdges } = useReactFlow()

  // "active" = a node this cord connects to is selected (flagged in
  // edge.data.active by the canvas), or the edge itself is selected.
  const active = !!(data as { active?: boolean } | undefined)?.active || !!selected
  const live = hovered || active

  // User preference from Settings → Performance: 'off' (static), 'on' (always
  // animate), or 'auto' (default — animate everything on small canvases, only
  // what you touch on big ones).
  const mode =
    (data as { animMode?: 'auto' | 'on' | 'off' } | undefined)?.animMode ?? 'auto'

  // Animation gating. 'off' → never animate. Otherwise: small canvas (or 'on')
  // → idle cords drift; big canvas in 'auto' → only hover/active move; the
  // active count is capped either way so a huge multi-select can't animate
  // hundreds of cords at once.
  const allEdges = getEdges()
  const idleAnimAllowed = mode === 'on' ? true : allEdges.length <= ANIM_BUDGET
  const activeCount = active
    ? allEdges.filter(
        (e) => (e.data as { active?: boolean } | undefined)?.active || e.selected,
      ).length
    : 0
  const animate =
    mode === 'off'
      ? false
      : hovered || (active ? activeCount <= ANIM_CAP : idleAnimAllowed)

  // Bezier control points from the handle directions.
  const geo = useMemo(() => {
    const p0: XY = { x: sourceX, y: sourceY }
    const p1: XY = { x: targetX, y: targetY }
    const ns = normalFor(sourcePosition)
    const nt = normalFor(targetPosition)
    const dist = Math.hypot(targetX - sourceX, targetY - sourceY)
    const k = Math.min(Math.max(dist * 0.4, 40), 220)
    const c1: XY = { x: p0.x + ns.x * k, y: p0.y + ns.y * k }
    const c2: XY = { x: p1.x + nt.x * k, y: p1.y + nt.y * k }
    const smooth = strand(p0, c1, c2, p1, 0, 0, 0)
    const mid = cubic(p0, c1, c2, p1, 0.5)
    return { p0, p1, c1, c2, dist, smooth, mid }
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

  // Bigger braid when live, gentle when idle-drifting. Scaled to cord length
  // so long and short cords both read well.
  const amp = live
    ? Math.min(15, geo.dist * 0.075)
    : Math.min(8, geo.dist * 0.05)
  const twists = 1.6

  // Only build morph sets when actually animating.
  const anim = useMemo(() => {
    if (!animate) return null
    const { p0, c1, c2, p1 } = geo
    return {
      halo: variants(p0, c1, c2, p1, amp, twists, 0),
      mid: variants(p0, c1, c2, p1, amp * 0.82, twists, 2.1),
      core: variants(p0, c1, c2, p1, amp * 0.9, twists, 4.2),
    }
  }, [animate, geo, amp])

  const baseColor = (style?.stroke as string) || '#aec3d2'
  const coreColor = live ? '#e7f1fb' : baseColor

  const handleCut = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEdges((edges) => edges.filter((edge) => edge.id !== id))
  }

  return (
    <>
      {/* Invisible wide stroke for easy hover / cut targeting. */}
      <path
        d={geo.smooth}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />

      {animate && anim ? (
        live ? (
          // ACTIVE / HOVER: bigger braid, brighter, soft blurred glow.
          <>
            <LiveStrand values={anim.halo} dur={7} width={9} color={baseColor} opacity={0.22} blurPx={4} />
            <LiveStrand values={anim.mid} dur={6} width={2} color={baseColor} opacity={0.6} glow />
            <LiveStrand values={anim.core} dur={6.5} width={1} color={coreColor} opacity={0.98} glow />
          </>
        ) : (
          // IDLE DRIFT (small canvas): gentle, dim, no blur (cheap).
          <>
            <LiveStrand values={anim.halo} dur={10} width={5} color={baseColor} opacity={0.1} />
            <LiveStrand values={anim.mid} dur={8.5} width={1.6} color={baseColor} opacity={0.4} />
            <LiveStrand values={anim.core} dur={9} width={0.9} color={coreColor} opacity={0.55} />
          </>
        )
      ) : (
        // STATIC (big canvas, idle): clean soft cord, no animation.
        <>
          <path d={geo.smooth} fill="none" stroke={baseColor} strokeWidth={4.5} strokeLinecap="round" opacity={0.12} />
          <path d={geo.smooth} fill="none" stroke={coreColor} strokeWidth={1.3} strokeLinecap="round" opacity={0.55} />
        </>
      )}

      {/* Lit "plugs" where the cord meets each node — gentle pulse when live. */}
      {[geo.p0, geo.p1].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={live ? 5.5 : 4.5} fill="#aec3d2" opacity={live ? 0.3 : 0.16} />
          <circle cx={p.x} cy={p.y} r={1.9} fill="#e7f1fb" opacity={live ? 0.9 : 0.55}>
            {live && (
              <animate
                attributeName="opacity"
                values="0.5;0.9;0.5"
                dur="3.2s"
                begin={`${i * 1.4}s`}
                repeatCount="indefinite"
              />
            )}
          </circle>
        </g>
      ))}

      {/* Scissors button at the cord midpoint — appears on hover. */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${geo.mid.x}px, ${geo.mid.y}px)`,
            pointerEvents: 'all',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="nodrag nopan"
        >
          <button
            onClick={handleCut}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: hovered ? '#1a1d21' : 'transparent',
              border: hovered ? '1.5px solid rgba(168,176,184,0.6)' : '1.5px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
            }}
            title="Disconnect"
          >
            <Scissors size={11} weight="bold" style={{ color: '#A8B0B8' }} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
