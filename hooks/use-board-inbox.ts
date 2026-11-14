import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import { toast } from 'sonner'
import { labelFromPrompt } from '@/lib/auto-name'

// Puts drafts that Claude was told to keep onto the open board.
//
// The canvas owns its nodes: every save replaces the whole set, so anything
// the server inserted on its own would be wiped by the next autosave. Kept
// drafts therefore wait in a queue (/api/projects/<id>/board-inbox) and this
// hook, running inside the canvas, adds them as nodes like any other edit.
//
// Adding a node makes this tab autosave, and a save replaces the board with
// this tab's copy. So before adding anything the tab has to CLAIM the drafts,
// and the server only grants a claim to a tab whose copy of the board is the
// current one (lib/canvas-rev.ts), and only to one tab at a time. An
// out-of-date tab, or a second tab on the same project, is told no: it adds
// nothing, saves nothing, and so can't write its old copy over newer work.
//
// A draft is confirmed as placed only once a save has gone through with it on
// the board. Close the tab before that and it is offered again later.

interface InboxItem {
  number: number
  assetId: string
  url: string
  type: string
  prompt: string
  modelId?: string | null
  aspectRatio?: string
  resolution?: string
  quality?: string
  duration?: string
  enableAudio?: boolean
}

const POLL_MS = 10_000
// While the Claude connection is off there is nothing to fetch; look again
// now and then in case it gets turned on with this canvas still open.
const POLL_OFF_MS = 5 * 60_000
const COLUMNS = 3
const GAP = 380
const STALE_TOAST = 'board-inbox-stale'

export function useBoardInbox(opts: {
  projectId: string | undefined
  /** The canvas has finished loading its saved nodes. Nothing is added before that. */
  ready: boolean
  getNodes: () => Node[]
  setNodes: (update: (nodes: Node[]) => Node[]) => void
  activeSceneId: string
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  saveStatus: 'saved' | 'unsaved' | 'saving'
  /** The board revision this tab holds: from its load, then from each of its saves. */
  revRef: { current: number | null }
}) {
  const { projectId, ready, saveStatus } = opts
  // Latest callbacks/values without restarting the poll loop on every render.
  const latest = useRef(opts)
  latest.current = opts
  const awaitingSave = useRef<number[]>([])
  // Names this tab to the server, so a claim it made is still its own on retry.
  const tabId = useRef('')
  if (!tabId.current) tabId.current = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

  const post = (body: Record<string, unknown>) =>
    fetch(`/api/projects/${projectId}/board-inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const confirm = (numbers: number[]) => {
    if (!projectId || numbers.length === 0) return
    post({ placed: numbers }).catch(() => {
      // Not confirmed: the queue offers them again, and the on-board check
      // below recognises them, so nothing is added twice.
    })
  }

  useEffect(() => {
    if (!projectId || !ready) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      let next = POLL_MS
      try {
        const res = await fetch(`/api/projects/${projectId}/board-inbox`, { cache: 'no-store' })
        const data = res.ok ? ((await res.json()) as { enabled?: boolean; items?: InboxItem[] }) : null
        if (stopped) return
        if (data && data.enabled === false) next = POLL_OFF_MS
        const items = data?.items || []
        if (items.length > 0) await take(items)
      } catch {
        // Offline or a hiccup: try again on the normal schedule.
      }
      if (!stopped) timer = setTimeout(tick, next)
    }

    const take = async (items: InboxItem[]) => {
      const onBoard = latest.current.getNodes()
      const isOnBoard = (it: InboxItem) =>
        onBoard.some((n) => n.data?.assetId === it.assetId || n.data?.outputUrl === it.url || n.data?.thumbnail === it.url)
      const already = items.filter(isOnBoard)
      const wanted = items.filter((it) => !isOnBoard(it))

      // Already there (placed earlier, confirmation lost): confirm, unless a
      // save with them is still pending.
      confirm(already.map((it) => it.number).filter((n) => !awaitingSave.current.includes(n)))
      if (wanted.length === 0) return

      // Ask for them. Granted only if this tab's copy of the board is current
      // and no other tab has taken them.
      const rev = latest.current.revRef.current
      if (rev === null) return
      const res = await post({ claim: wanted.map((it) => it.number), tab: tabId.current, rev })
      const granted = res.ok ? ((await res.json()) as { claimed?: number[]; stale?: boolean }) : null
      if (stopped || !granted) return
      if (granted.stale) {
        // Another tab or device has saved this board since this one loaded.
        // Say so once; a reload brings the board up to date and the shots in.
        toast.info(
          wanted.length === 1
            ? 'Claude has a shot for this board, but the board was changed somewhere else'
            : `Claude has ${wanted.length} shots for this board, but the board was changed somewhere else`,
          { id: STALE_TOAST, description: 'Reload this page to bring it up to date. Nothing was changed here.', duration: Infinity },
        )
        return
      }
      const claimed = new Set(granted.claimed || [])
      const fresh = wanted.filter((it) => claimed.has(it.number))
      if (fresh.length > 0) place(fresh)
    }

    const place = (fresh: InboxItem[]) => {
      const { setNodes, activeSceneId, screenToFlowPosition } = latest.current
      // A tidy grid around the middle of what the user is looking at.
      const centre = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const cols = Math.min(COLUMNS, fresh.length)
      const left = centre.x - ((cols - 1) * GAP) / 2 - 160
      const stamp = Date.now()
      const newNodes: Node[] = fresh.map((it, i) => {
        const position = { x: left + (i % cols) * GAP, y: centre.y - 160 + Math.floor(i / cols) * GAP }
        const label = labelFromPrompt(it.prompt) || `Claude draft ${it.number}`
        const base = { sceneId: activeSceneId, isUploading: false, uploadError: false, assetId: it.assetId }
        // Starts with the moment it was added, like every node id: the board
        // view reads a node's age from it.
        const id = `node-${stamp}-${i}${Math.random().toString(36).slice(2, 7)}`
        if (it.type === 'image') {
          // An image node that already holds its result, with the prompt and
          // settings it was made with, so it can be reworked on the board.
          return {
            id,
            type: 'imageGen',
            position,
            data: {
              ...base,
              label,
              thumbnail: undefined,
              prompt: it.prompt,
              modelId: it.modelId || undefined,
              aspectRatio: it.aspectRatio,
              resolution: it.resolution,
              quality: it.quality,
              outputUrl: it.url,
            },
          }
        }
        if (it.type === 'video') {
          // Same idea for a clip: a video node holding its result and settings.
          // The node captures its own poster frame once it has loaded the clip.
          return {
            id,
            type: 'videoGen',
            position,
            data: {
              ...base,
              label,
              thumbnail: undefined,
              prompt: it.prompt,
              modelId: it.modelId || undefined,
              aspectRatio: it.aspectRatio,
              resolution: it.resolution,
              duration: it.duration,
              enableAudio: it.enableAudio ?? false,
              outputUrl: it.url,
            },
          }
        }
        return {
          id: `ref-${stamp}-${i}`,
          type: 'reference',
          position,
          data: { ...base, label, thumbnail: it.url, mediaType: it.type === 'audio' ? 'audio' : 'image' },
        }
      })
      setNodes((ns) => [...ns, ...newNodes])
      awaitingSave.current = [...awaitingSave.current, ...fresh.map((it) => it.number)]
      window.dispatchEvent(new CustomEvent('asset-status-changed'))
      toast.success(
        fresh.length === 1 ? 'Claude put 1 shot on the board' : `Claude put ${fresh.length} shots on the board`,
      )
    }

    tick()
    // Coming back to the window is when new keeps are most likely waiting.
    const onFocus = () => {
      if (timer) clearTimeout(timer)
      tick()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ready])

  // The autosave went through with the new nodes on the board: confirm them.
  useEffect(() => {
    if (saveStatus !== 'saved' || awaitingSave.current.length === 0) return
    const numbers = awaitingSave.current
    awaitingSave.current = []
    confirm(numbers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus])
}
