import { useCallback, useRef, useEffect, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'

// Minimal shape of what we persist per scene. Shots are derived from
// nodes by canvas-workspace's scenesWithShots memo and don't belong
// in the saved payload.
type PersistedScene = { id: string; name: string }

export function useCanvasAutoSave(
  projectId: string | undefined,
  nodes: Node[],
  edges: Edge[],
  scenes: PersistedScene[],
  activeSceneId: string,
) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef<string>('')
  const isSavingRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')

  // Always send the bare-bones scene shape, dropping any shots[] that
  // might be on the in-memory Scene object (scenesWithShots adds them).
  // Keeps the diff stable across renders that only change derived shots.
  const persistedScenes: PersistedScene[] = scenes.map(s => ({
    id: s.id,
    name: s.name,
  }))

  const saveCanvas = useCallback(async (force = false) => {
    if (!projectId || isSavingRef.current) return

    // Check if anything has changed
    const currentState = JSON.stringify({ nodes, edges, scenes: persistedScenes, activeSceneId })

    if (!force && currentState === lastSavedRef.current) {
      return // No changes, don't save
    }

    // FAILSAFE: never POST an empty-nodes payload if the last successful
    // save had content. This guards against transient state glitches
    // (project switch races, error boundaries, an unmount beacon firing
    // mid-render) that would otherwise wipe the canvas. The server has a
    // matching guard but blocking here saves the round-trip entirely.
    if (nodes.length === 0 && lastSavedRef.current) {
      try {
        const last = JSON.parse(lastSavedRef.current)
        if (Array.isArray(last.nodes) && last.nodes.length > 0) {
          console.warn(
            '[Canvas] Skipping empty-nodes autosave; previous save had content',
          )
          return
        }
      } catch {
        // If we can't parse the last state, fall through and let the
        // server-side guard handle it.
      }
    }

    isSavingRef.current = true
    setSaveStatus('saving')

    try {
      const response = await fetch(`/api/projects/${projectId}/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, scenes: persistedScenes, activeSceneId }),
      })

      if (response.ok) {
        lastSavedRef.current = currentState
        setSaveStatus('saved')
      } else {
        console.error('[Canvas] Failed to save')
        setSaveStatus('unsaved')
      }
    } catch (error) {
      console.error('[Canvas] Error saving:', error)
      setSaveStatus('unsaved')
    } finally {
      isSavingRef.current = false
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId])

  // Mark as unsaved when nodes/edges/scenes/activeSceneId change
  useEffect(() => {
    if (!projectId || nodes.length === 0) return

    const currentState = JSON.stringify({ nodes, edges, scenes: persistedScenes, activeSceneId })
    if (currentState !== lastSavedRef.current && lastSavedRef.current !== '') {
      setSaveStatus('unsaved')
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId])

  // Debounced save on changes (3 second delay after last change).
  // Also fires for scene rename / add / delete / active-scene change,
  // so a delete-scene confirmation isn't lost if the user quickly
  // closes the tab afterward.
  useEffect(() => {
    if (!projectId || nodes.length === 0) return

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveCanvas()
    }, 3000) // Save 3 seconds after last change

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId, saveCanvas])

  // Auto-save on interval (every 30 seconds as backup).
  //
  // Earlier version listed `saveCanvas` in the dep array — and saveCanvas
  // is a useCallback whose own deps include `nodes` + `edges`. So every
  // keystroke gave saveCanvas a new identity, the effect tore down the
  // 30s timer, and the backup save effectively never fired during active
  // editing. Now we route through a ref that gets updated each render,
  // and the interval effect itself only depends on `projectId`. The 30s
  // tick actually elapses; saveCanvas's own "nothing changed since last
  // save" guard keeps it from generating noise when there's nothing new.
  const saveCanvasRef = useRef(saveCanvas)
  useEffect(() => {
    saveCanvasRef.current = saveCanvas
  }, [saveCanvas])
  useEffect(() => {
    if (!projectId) return
    const interval = setInterval(() => saveCanvasRef.current?.(), 30000)
    return () => clearInterval(interval)
  }, [projectId])

  // Save on unmount — including scenes/activeSceneId so a tab close
  // mid-edit doesn't lose a freshly-added or freshly-deleted scene.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (projectId && nodes.length > 0) {
        navigator.sendBeacon?.(
          `/api/projects/${projectId}/canvas`,
          JSON.stringify({ nodes, edges, scenes: persistedScenes, activeSceneId }),
        )
      }
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId])

  return { saveCanvas, saveStatus }
}
