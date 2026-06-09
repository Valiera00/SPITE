'use client'

import { useMemo } from 'react'
import { useStore } from '@xyflow/react'
import type { ShotOption } from './shot-selector'

// Builds the per-scene shot dropdown list for a node, without retriggering
// a re-render every time *any* sibling node's state changes.
//
// `useNodes()` returns the entire nodes array, so any node update (a
// keystroke in a prompt textarea, a generation completing, etc.) made
// every node calling it re-render. We instead subscribe to a small string
// "signature" of just the shot-relevant fields. Subscribers re-render
// only when that string changes — which is exactly when the shot list
// would change.
export function useSceneShots(selfNodeId: string): ShotOption[] {
  const signature = useStore((state) => {
    const self = state.nodes.find((n) => n.id === selfNodeId)
    const sceneId = (self?.data as any)?.sceneId as string | undefined
    const parts: string[] = []
    for (const n of state.nodes) {
      if (sceneId && (n.data as any)?.sceneId !== sceneId) continue
      // Read both fields: image/video-gen + new reference-node writes
      // land in `shotId`; legacy reference-node assignments are in
      // `selectedShotId`. We want the dropdown to expose both so an
      // existing project keeps working until the user re-touches the
      // old refs.
      const shotId =
        (n.data as any)?.shotId || (n.data as any)?.selectedShotId
      if (!shotId) continue
      const match = String(shotId).match(/^shot-(\d+)$/)
      if (!match) continue
      const thumb =
        n.type === 'videoGen'
          ? ((n.data as any)?.videoThumbnail || (n.data as any)?.thumbnail || '')
          : ((n.data as any)?.outputUrl || (n.data as any)?.thumbnail || '')
      parts.push(`${match[1]}|${thumb}|${n.type === 'videoGen' ? '1' : '0'}`)
    }
    parts.sort()
    return parts.join(';')
  })

  return useMemo(() => {
    if (!signature) return [{ id: 'shot-1', label: 'Shot 1' }]
    const byShot = new Map<number, { thumb?: string; hasVideo: boolean }>()
    let maxNum = 0
    for (const part of signature.split(';')) {
      if (!part) continue
      const [numStr, thumb, vid] = part.split('|')
      const num = parseInt(numStr, 10)
      if (Number.isNaN(num)) continue
      if (num > maxNum) maxNum = num
      const candidate = { thumb: thumb || undefined, hasVideo: vid === '1' }
      const existing = byShot.get(num)
      if (!existing) {
        byShot.set(num, candidate)
      } else if (!existing.thumb && candidate.thumb) {
        byShot.set(num, {
          thumb: candidate.thumb,
          hasVideo: existing.hasVideo || candidate.hasVideo,
        })
      }
    }
    if (maxNum === 0) return [{ id: 'shot-1', label: 'Shot 1' }]
    const list: ShotOption[] = []
    for (let i = 1; i <= maxNum; i++) {
      const info = byShot.get(i)
      list.push({
        id: `shot-${i}`,
        label: `Shot ${i}`,
        thumbnail: info?.thumb,
        hasVideo: info?.hasVideo,
      })
    }
    return list
  }, [signature])
}
