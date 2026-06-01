'use client'

import { useViewport } from '@xyflow/react'
import type { Node } from '@xyflow/react'

// Photoshop / Figma-style smart guides. When the user drags a node and
// any of its edges or center aligns with another node's edges or center
// (within THRESHOLD flow-coordinate pixels), a full-canvas line is
// rendered through the matching coordinate to make the alignment
// visible. Compute on every drag tick from the workspace, pass the
// resulting flow-coordinate guide list to this component.

const THRESHOLD = 4

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
    // Vertical guides — X alignment.
    if (Math.abs(d.left - o.left) < THRESHOLD) vertical.add(o.left)
    if (Math.abs(d.left - o.right) < THRESHOLD) vertical.add(o.right)
    if (Math.abs(d.right - o.right) < THRESHOLD) vertical.add(o.right)
    if (Math.abs(d.right - o.left) < THRESHOLD) vertical.add(o.left)
    if (Math.abs(d.centerX - o.centerX) < THRESHOLD) vertical.add(o.centerX)
    // Horizontal guides — Y alignment.
    if (Math.abs(d.top - o.top) < THRESHOLD) horizontal.add(o.top)
    if (Math.abs(d.top - o.bottom) < THRESHOLD) horizontal.add(o.bottom)
    if (Math.abs(d.bottom - o.bottom) < THRESHOLD) horizontal.add(o.bottom)
    if (Math.abs(d.bottom - o.top) < THRESHOLD) horizontal.add(o.top)
    if (Math.abs(d.centerY - o.centerY) < THRESHOLD) horizontal.add(o.centerY)
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
          className="absolute top-0 bottom-0 w-px bg-cyan-400/80 shadow-[0_0_3px_rgba(34,211,238,0.5)]"
          style={{ left: vx + flowX * zoom }}
        />
      ))}
      {horizontal.map((flowY, i) => (
        <div
          key={`h-${i}-${flowY}`}
          className="absolute left-0 right-0 h-px bg-cyan-400/80 shadow-[0_0_3px_rgba(34,211,238,0.5)]"
          style={{ top: vy + flowY * zoom }}
        />
      ))}
    </div>
  )
}
