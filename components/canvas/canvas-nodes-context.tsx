'use client'

import { createContext, useContext } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'

// Read and write the canvas's FULL node list from inside a node.
//
// React Flow only ever holds the nodes of the scene on screen (the canvas
// passes it a scene-filtered list), and useReactFlow().setNodes applies its
// updater to that list. So a node whose scene had been switched away — a
// generation's submit returning, a poll finishing, a poster upload landing —
// ran `ns.map(n => n.id === id ? … : n)` over a list it wasn't in, and its
// update was silently dropped. The worst casualty was the job id that lets a
// node pick its result back up: switch scene before the submit returned and
// the render was billed but never shown.
//
// Nodes use this instead. Inside the canvas it is wired to the canvas's own
// state, which holds every scene; outside one it falls back to React Flow.

type SetNodes = (payload: Node[] | ((nodes: Node[]) => Node[])) => void

export interface CanvasNodesApi {
  setNodes: SetNodes
  getNodes: () => Node[]
}

export const CanvasNodesContext = createContext<CanvasNodesApi | null>(null)

export function useCanvasNodes(): CanvasNodesApi {
  const ctx = useContext(CanvasNodesContext)
  const rf = useReactFlow()
  return ctx ?? { setNodes: rf.setNodes as SetNodes, getNodes: rf.getNodes as () => Node[] }
}
