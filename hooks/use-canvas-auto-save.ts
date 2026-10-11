import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { toast } from 'sonner'
import { canvasPayload } from '@/lib/canvas-payload'

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
  // A save was requested while one was in flight. The old behaviour was to
  // drop that request on the floor and hope the 30s heartbeat caught the
  // change — on a big canvas, where a save takes several seconds, that left a
  // window in which edits were simply never written. Now the request is
  // remembered and runs as soon as the in-flight save finishes.
  const pendingRef = useRef(false)
  // Latest saveCanvas, for the heartbeat and the queued re-run above.
  const saveCanvasRef = useRef<(force?: boolean) => Promise<void>>(async () => {})
  // One toast per failure streak, not one per retry.
  const failToastedRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')

  // Always send the bare-bones scene shape, dropping any shots[] that
  // might be on the in-memory Scene object (scenesWithShots adds them).
  // Keeps the diff stable across renders that only change derived shots.
  // Memoized so its identity is stable across renders — otherwise saveCanvas
  // (which lists it as a dep) got a new identity every render and re-ran all
  // the autosave effects.
  const persistedScenes: PersistedScene[] = useMemo(
    () => scenes.map(s => ({ id: s.id, name: s.name })),
    [scenes],
  )

  const saveCanvas = useCallback(async (force = false) => {
    if (!projectId) return
    if (isSavingRef.current) {
      pendingRef.current = true
      return
    }

    // Check if anything has changed. Inline media is dropped from the body
    // (see lib/canvas-payload.ts) so a poster frame arriving in memory
    // doesn't count as a change worth a save.
    const currentState = canvasPayload({ nodes, edges, scenes: persistedScenes, activeSceneId })

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
        body: currentState,
      })

      if (response.ok) {
        lastSavedRef.current = currentState
        setSaveStatus('saved')
        failToastedRef.current = false
      } else {
        // Say WHY. A bare "Failed to save" hid a week of 413s and 504s.
        const detail = await response.text().catch(() => '')
        console.error(`[Canvas] Save failed: HTTP ${response.status}`, detail.slice(0, 300))
        setSaveStatus('unsaved')
        if (!failToastedRef.current) {
          failToastedRef.current = true
          toast.error(`Canvas not saved (HTTP ${response.status}). Retrying in the background — don't close the tab yet.`)
        }
      }
    } catch (error) {
      console.error('[Canvas] Error saving:', error)
      setSaveStatus('unsaved')
      if (!failToastedRef.current) {
        failToastedRef.current = true
        toast.error('Canvas not saved (network error). Retrying in the background — don\'t close the tab yet.')
      }
    } finally {
      isSavingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        void saveCanvasRef.current()
      }
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId])

  // Mark as unsaved when nodes/edges/scenes/activeSceneId change. This used to
  // JSON.stringify the entire canvas on every change to compare against the
  // last save — which meant a full-canvas serialize on every drag tick, the
  // main source of drag jank on a large board. The status is just a UI hint, so
  // we optimistically flag "unsaved" on any change; the debounced saveCanvas
  // still does the real change-check before POSTing and flips it back to saved.
  useEffect(() => {
    if (!projectId || nodes.length === 0) return
    if (lastSavedRef.current !== '') {
      setSaveStatus(prev => (prev === 'saving' ? prev : 'unsaved'))
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
  //
  // sendBeacon refuses anything over ~64 KB, and returns false rather than
  // throwing, so for a large canvas this save never happened and nothing
  // said so. The beforeunload guard below is what actually protects a big
  // board: it makes the browser ask before closing while a save is pending.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (projectId && nodes.length > 0) {
        const sent = navigator.sendBeacon?.(
          `/api/projects/${projectId}/canvas`,
          canvasPayload({ nodes, edges, scenes: persistedScenes, activeSceneId }),
        )
        if (sent === false) console.warn('[Canvas] unload save too large for sendBeacon; relying on the last autosave')
      }
    }
  }, [projectId, nodes, edges, persistedScenes, activeSceneId])

  // Ask before the tab closes with unsaved changes. The browser shows its own
  // "Leave site?" dialog; a quick Cancel, a couple of seconds, and the
  // pending autosave lands.
  useEffect(() => {
    if (saveStatus === 'saved') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveStatus])

  return { saveCanvas, saveStatus }
}
