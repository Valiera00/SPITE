'use client'

import { useViewport } from '@xyflow/react'
import type { Node } from '@xyflow/react'

// Photoshop / Figma-style smart guides. When the user drags a node and
// any of its edges or center aligns with another node's edges or center
// (within THRESHOLD flow-coordinate pixels), a full-canvas line is
// rendered through the dragged node's coordinate to make the alignment
// visible. Compute on every drag tick from the workspace, pass the
// resulting flow-coordinate guide list to this component.
//
// THRESHOLD is intentionally tight — 4px was emitting false positives
// where one node's center happened to be near another's left edge by
// coincidence. 2px means you actually have to be on the line.

const THRESHOLD = 2

// React Flow attaches measured width/height to each node after the first
// render. For nodes that haven't measured yet, fall back to a typical
// size — guides may be off by a few pixels until measurement lands.
function nodeBox(n: Node) {
  const w = n.width ?? 320
  const h = n.height ?? 480
  const left = n.position.x
  const top = n.position.y
  return {
    left,
    top,
    right: left + w,
    bottom: top + h,
    centerX: left + w / 2,
    centerY: top + h / 2,
  }
}

export function computeAlignmentGuides(
  dragged: Node | null,
  others: Node[],
): { vertical: number[]; horizontal: number[] } {
  if (!dragged) return { vertical: [], horizontal: [] }
  const d = nodeBox(dragged)
  const vertical = new Set<number>()
  const horizontal = new Set<number>()
  for (const other of others) {
    if (other.id === dragged.id) continue
    const o = nodeBox(other)
    // Vertical guides — X alignment. Line is anchored at the DRAGGED
    // node's edge, so the guide visually sits where the user's node
    // actually is. (Anchoring to the other node's edge could place the
    // line a couple px off from the dragged node when alignment is
    // near-but-not-exact, which reads as a "phantom" guide.)
    if (Math.abs(d.left - o.left) < THRESHOLD) vertical.add(d.left)
    if (Math.abs(d.left - o.right) < THRESHOLD) vertical.add(d.left)
    if (Math.abs(d.right - o.right) < THRESHOLD) vertical.add(d.right)
    if (Math.abs(d.right - o.left) < THRESHOLD) vertical.add(d.right)
    if (Math.abs(d.centerX - o.centerX) < THRESHOLD) vertical.add(d.centerX)
    // Horizontal guides — Y alignment, same anchoring approach.
    if (Math.abs(d.top - o.top) < THRESHOLD) horizontal.add(d.top)
    if (Math.abs(d.top - o.bottom) < THRESHOLD) horizontal.add(d.top)
    if (Math.abs(d.bottom - o.bottom) < THRESHOLD) horizontal.add(d.bottom)
    if (Math.abs(d.bottom - o.top) < THRESHOLD) horizontal.add(d.bottom)
    if (Math.abs(d.centerY - o.centerY) < THRESHOLD) horizontal.add(d.centerY)
  }
  return {
    vertical: Array.from(vertical),
    horizontal: Array.from(horizontal),
  }
}

interface Props {
  vertical: number[]
  horizontal: number[]
}

export function AlignmentGuides({ vertical, horizontal }: Props) {
  const { x: vx, y: vy, zoom } = useViewport()
  if (vertical.length === 0 && horizontal.length === 0) return null
  // Convert from flow coordinates to screen coordinates via the
  // viewport transform: screen = viewport_origin + flow * zoom.
  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {vertical.map((flowX, i) => (
        <div
          key={`v-${i}-${flowX}`}
          className="absolute top-0 bottom-0"
          style={{
            left: vx + flowX * zoom,
            width: 1,
            background: 'rgba(107,143,168,0.36)',
          }}
        />
      ))}
      {horizontal.map((flowY, i) => (
        <div
          key={`h-${i}-${flowY}`}
          className="absolute left-0 right-0"
          style={{
            top: vy + flowY * zoom,
            height: 1,
            background: 'rgba(107,143,168,0.36)',
          }}
        />
      ))}
    </div>
  )
}
