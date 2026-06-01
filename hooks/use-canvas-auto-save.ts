import { useCallback, useRef, useEffect, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'

export function useCanvasAutoSave(projectId: string | undefined, nodes: Node[], edges: Edge[]) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef<string>('')
  const isSavingRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')

  const saveCanvas = useCallback(async (force = false) => {
    if (!projectId || isSavingRef.current) return

    // Check if anything has changed
    const currentState = JSON.stringify({ nodes, edges })

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
        body: JSON.stringify({ nodes, edges }),
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
  }, [projectId, nodes, edges])

  // Mark as unsaved when nodes/edges change
  useEffect(() => {
    if (!projectId || nodes.length === 0) return
    
    const currentState = JSON.stringify({ nodes, edges })
    if (currentState !== lastSavedRef.current && lastSavedRef.current !== '') {
      setSaveStatus('unsaved')
    }
  }, [projectId, nodes, edges])

  // Debounced save on changes (3 second delay after last change)
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
  }, [projectId, nodes, edges, saveCanvas])

  // Auto-save on interval (every 30 seconds as backup)
  useEffect(() => {
    const interval = setInterval(() => saveCanvas(), 30000)
    return () => clearInterval(interval)
  }, [saveCanvas])

  // Save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      // Force save on unmount
      if (projectId && nodes.length > 0) {
        navigator.sendBeacon?.(
          `/api/projects/${projectId}/canvas`,
          JSON.stringify({ nodes, edges })
        )
      }
    }
  }, [projectId, nodes, edges])

  return { saveCanvas, saveStatus }
}
