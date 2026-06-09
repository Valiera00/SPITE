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
// Braided "cord" edge — inspired by the landing-page manifesto connectors.
//
// Two states, on purpose:
//   - IDLE        → one clean, soft, smooth glowing wire. No braid, no grain.
//   - HOVER/SELECT→ a gentle braided living cord (slow, soft twist) like the
//                    landing page, plus brighter strands and lit plugs.
//
// Performance guardrails:
//   - Idle cords draw two static strokes, no filters, no animation — so a
//     canvas full of edges costs almost nothing.
//   - The living twist only runs on the hovered cord (always 1) OR on a
//     SMALL multi-selection. If more than ANIM_CAP edges are selected at
//     once (e.g. a big box-select), they fall back to a bright *static*
//     highlight instead — you still see the selection, but we never animate
//     dozens of cords at once.
// ---------------------------------------------------------------------------

// Max number of simultaneously-selected cords we'll animate. Above this we
// fall back to a static highlight to protect frame rate.
const ANIM_CAP = 8

interface XY { x: number; y: number }

// Cubic bezier point + tangent at parameter t.
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

const SAMPLES = 26

// One strand sampled along the bezier with a sine-waved normal offset,
// enveloped so it tapers to zero at both ends (clean plug-in at the ports).
// amp = 0 yields the plain smooth centerline (used for the idle cord + hit).
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

// Morph targets for the gentle living twist: the strand at phases swept
// through a full turn, so SMIL cycles them smoothly.
function variants(
  p0: XY, c1: XY, c2: XY, p1: XY,
  amp: number, twists: number, phase0: number,
): string {
  const K = 6
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

// An animated strand (used only on live cords).
function LiveStrand({
  values, dur, width, color, opacity, glow,
}: {
  values: string
  dur: number
  width: number
  color: string
  opacity: number
  glow?: boolean
}) {
  // Initial `d` is the first morph target so there's no flash before SMIL starts.
  const first = values.split(';')[0]
  return (
    <path
      d={first}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={opacity}
      style={glow ? { filter: 'drop-shadow(0 0 2.5px rgba(180,205,225,0.6))' } : undefined}
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

  // "active" = a node this cord connects to is selected (flagged by the canvas
  // in edge.data.active), or the edge itself is selected. "live" = brighter
  // styling. "animate" = run the gentle twist: always on hover (1 cord), and
  // for active cords only while the active count stays within ANIM_CAP —
  // above that they brighten statically instead of all animating at once.
  const active = !!(data as { active?: boolean } | undefined)?.active || !!selected
  const live = hovered || active
  const activeCount = active
    ? getEdges().filter(
        (e) => (e.data as { active?: boolean } | undefined)?.active || e.selected,
      ).length
    : 0
  const animate = hovered || (active && activeCount <= ANIM_CAP)

  // Bezier control points from the handle directions; gentle braid amplitude.
  const geo = useMemo(() => {
    const p0: XY = { x: sourceX, y: sourceY }
    const p1: XY = { x: targetX, y: targetY }
    const ns = normalFor(sourcePosition)
    const nt = normalFor(targetPosition)
    const dist = Math.hypot(targetX - sourceX, targetY - sourceY)
    const k = Math.min(Math.max(dist * 0.4, 40), 220)
    const c1: XY = { x: p0.x + ns.x * k, y: p0.y + ns.y * k }
    const c2: XY = { x: p1.x + nt.x * k, y: p1.y + nt.y * k }
    // Gentle: lower amplitude than before so the twist is soft, not busy.
    const amp = Math.min(4, dist * 0.04)
    const smooth = strand(p0, c1, c2, p1, 0, 0, 0) // clean centerline (idle + hit)
    const mid = cubic(p0, c1, c2, p1, 0.5)
    return { p0, p1, c1, c2, amp, smooth, mid }
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

  // Animation morph sets — only built when actually animating.
  const anim = useMemo(() => {
    if (!animate) return null
    const { p0, c1, c2, p1, amp } = geo
    return {
      halo: variants(p0, c1, c2, p1, amp, 1.5, 0),
      mid: variants(p0, c1, c2, p1, amp * 0.8, 1.5, 2.1),
      core: variants(p0, c1, c2, p1, amp * 0.9, 1.5, 4.2),
    }
  }, [animate, geo])

  const baseColor = (style?.stroke as string) || '#aec3d2'
  const coreColor = live ? '#dcebf7' : baseColor

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
        // LIVE: gentle braided living cord.
        <>
          <LiveStrand values={anim.halo} dur={9} width={6} color={baseColor} opacity={0.16} />
          <LiveStrand values={anim.mid} dur={7} width={2.2} color={baseColor} opacity={0.55} />
          <LiveStrand values={anim.core} dur={8} width={1.1} color={coreColor} opacity={0.95} glow />
        </>
      ) : (
        // IDLE (or large multi-select fallback): clean, soft, smooth cord.
        // Two stacked strokes give a gentle glow with no grain and no filter.
        <>
          <path
            d={geo.smooth}
            fill="none"
            stroke={baseColor}
            strokeWidth={live ? 5 : 4.5}
            strokeLinecap="round"
            opacity={live ? 0.18 : 0.12}
          />
          <path
            d={geo.smooth}
            fill="none"
            stroke={coreColor}
            strokeWidth={live ? 1.5 : 1.3}
            strokeLinecap="round"
            opacity={live ? 0.9 : 0.55}
          />
        </>
      )}

      {/* Lit "plugs" where the cord meets each node. */}
      {[geo.p0, geo.p1].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={live ? 5 : 4.5} fill="#aec3d2" opacity={live ? 0.28 : 0.16} />
          <circle cx={p.x} cy={p.y} r={1.8} fill="#dcebf7" opacity={live ? 0.85 : 0.55} />
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
