'use client'

import { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { Scissors } from '@phosphor-icons/react'

export function ScissorsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const { setEdges } = useReactFlow()

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleCut = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEdges(edges => edges.filter(edge => edge.id !== id))
  }

  return (
    <>
      {/* Invisible wide stroke for easier hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />

      {/* Actual visible edge */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeDasharray: '6 4',
          strokeLinecap: 'round',
          transition: 'stroke 0.15s, stroke-width 0.15s',
          stroke: hovered ? '#6B8FA8' : (style?.stroke as string ?? '#A8B0B8'),
          strokeWidth: hovered ? 2.5 : (style?.strokeWidth as number ?? 2),
          pointerEvents: 'none',
        }}
      />

      {/* Scissors button at midpoint */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
              border: hovered ? '1.5px solid rgba(107,143,168,0.6)' : '1.5px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
            }}
            title="Disconnect"
          >
            <Scissors size={11} weight="bold" style={{ color: '#6B8FA8' }} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
