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
// Braided "cord" edge — ported from the landing-page manifesto connectors.
//
// Each connection is drawn as three strands woven along a bezier curve, with
// a lit "plug" at each end. The braid SHAPE is static (computed once, cheap)
// so a canvas full of edges stays smooth. The living twist animation — the
// part that's expensive at scale — runs ONLY on the hovered/selected edge,
// so at most one or two cords animate at a time. No SVG blur filters (the
// other big cost); the glow is faked with stacked strokes.
// ---------------------------------------------------------------------------

// Cubic bezier point + tangent at parameter t.
function cubic(
  p0: XY, c1: XY, c2: XY, p1: XY, t: number,
): XY {
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

interface XY { x: number; y: number }

const SAMPLES = 26 // points per strand — enough for a smooth braid, cheap to draw

// One strand: a sine-waved offset along the bezier normal, enveloped so it
// tapers to zero at both ends (clean plug-in at the ports). amp=0 yields the
// plain centerline (used for the invisible hit area).
function strand(
  p0: XY, c1: XY, c2: XY, p1: XY,
  amp: number, twists: number, phase: number,
): string {
  let d = ''
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const pt = cubic(p0, c1, c2, p1, t)
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

// Morph targets for the hover animation: the same strand at phases swept
// through a full turn, so SMIL can cycle them into a living twist.
function variants(
  p0: XY, c1: XY, c2: XY, p1: XY,
  amp: number, twists: number, phase0: number,
): string {
  const K = 5
  const v: string[] = []
  for (let k = 0; k <= K; k++) {
    v.push(strand(p0, c1, c2, p1, amp, twists, phase0 + (k / K) * Math.PI * 2))
  }
  return v.join(';')
}

// Outward unit normal for a handle side.
function normalFor(pos: Position | undefined): XY {
  switch (pos) {
    case Position.Left: return { x: -1, y: 0 }
    case Position.Right: return { x: 1, y: 0 }
    case Position.Top: return { x: 0, y: -1 }
    case Position.Bottom: return { x: 0, y: 1 }
    default: return { x: 1, y: 0 }
  }
}

// A single strand <path>. When `animate` is set it carries a SMIL morph;
// otherwise it's a static braid frozen mid-twist.
function Strand({
  d, values, dur, width, color, opacity, animate, glow,
}: {
  d: string
  values: string
  dur: number
  width: number
  color: string
  opacity: number
  animate: boolean
  glow?: boolean
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={opacity}
      style={glow ? { filter: 'drop-shadow(0 0 2px rgba(170,195,210,0.55))' } : undefined}
    >
      {animate && (
        <animate
          attributeName="d"
          dur={`${dur}s`}
          repeatCount="indefinite"
          calcMode="linear"
          values={values}
        />
      )}
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
  const { setEdges } = useReactFlow()
  const live = hovered || !!selected

  // Build the bezier control points from the handle directions (same idea as
  // the manifesto cords): push the controls outward along each side's normal,
  // scaled by the endpoint distance so short and long hops both curve nicely.
  const geo = useMemo(() => {
    const p0: XY = { x: sourceX, y: sourceY }
    const p1: XY = { x: targetX, y: targetY }
    const ns = normalFor(sourcePosition)
    const nt = normalFor(targetPosition)
    const dist = Math.hypot(targetX - sourceX, targetY - sourceY)
    const k = Math.min(Math.max(dist * 0.4, 40), 220)
    const c1: XY = { x: p0.x + ns.x * k, y: p0.y + ns.y * k }
    const c2: XY = { x: p1.x + nt.x * k, y: p1.y + nt.y * k }
    const amp = Math.min(6, dist * 0.06) // gentle braid; vanishes on tiny edges
    const mid = cubic(p0, c1, c2, p1, 0.5)
    // Three woven strands at offset phases (static "d"); plus the plain
    // centerline for the invisible hover hit area.
    const halo = strand(p0, c1, c2, p1, amp, 1.5, 0)
    const glow = strand(p0, c1, c2, p1, amp * 0.8, 1.5, 2.1)
    const core = strand(p0, c1, c2, p1, amp * 0.9, 1.5, 4.2)
    const hit = strand(p0, c1, c2, p1, 0, 0, 0)
    return {
      p0, p1, c1, c2, amp, mid, halo, glow, core, hit,
    }
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

  // Animation values only computed (and only used) when the cord is live.
  const vHalo = live ? variants(geo.p0, geo.c1, geo.c2, geo.p1, geo.amp, 1.5, 0) : ''
  const vGlow = live ? variants(geo.p0, geo.c1, geo.c2, geo.p1, geo.amp * 0.8, 1.5, 2.1) : ''
  const vCore = live ? variants(geo.p0, geo.c1, geo.c2, geo.p1, geo.amp * 0.9, 1.5, 4.2) : ''

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
        d={geo.hit}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />

      {/* Strand 1 — wide, faint halo (the "glow" without a blur filter). */}
      <Strand
        d={geo.halo}
        values={vHalo}
        dur={9}
        width={live ? 6 : 5}
        color={baseColor}
        opacity={live ? 0.16 : 0.1}
        animate={live}
      />
      {/* Strand 2 — mid body. */}
      <Strand
        d={geo.glow}
        values={vGlow}
        dur={7}
        width={2.2}
        color={baseColor}
        opacity={live ? 0.55 : 0.4}
        animate={live}
      />
      {/* Strand 3 — bright core (gets the subtle glow on hover). */}
      <Strand
        d={geo.core}
        values={vCore}
        dur={8}
        width={1}
        color={coreColor}
        opacity={live ? 0.95 : 0.6}
        animate={live}
        glow={live}
      />

      {/* Lit "plugs" where the cord meets each node. */}
      {[geo.p0, geo.p1].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={live ? 5 : 4.5} fill="#aec3d2" opacity={live ? 0.28 : 0.18} />
          <circle cx={p.x} cy={p.y} r={1.8} fill="#dcebf7" opacity={live ? 0.85 : 0.6} />
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
