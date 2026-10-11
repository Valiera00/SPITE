// Shapes the canvas state before it is sent to /api/projects/<id>/canvas.
//
// Node data must never carry inline media. A base64 `data:` poster frame is
// 25-46 KB per video node, so a project with ~80 video nodes was shipping a
// 2.4 MB JSON body on EVERY autosave: slow enough that edits made mid-save
// were dropped, far past the 64 KB that `sendBeacon` will send on tab close
// (so the closing save silently never happened), and on course for Vercel's
// 4.5 MB request limit, past which every save fails. A `blob:` URL is worse
// still — it is only meaningful inside the tab that created it.
//
// Both are dropped from the payload here. Posters are derived data: the video
// node re-captures one and uploads it to R2 as a real file (see
// lib/poster-upload.ts), after which the field is a short URL again.

const INLINE_DATA_MIN_BYTES = 2048

type NodeLike = { data?: Record<string, unknown> | undefined }

function isInlineMedia(v: unknown): boolean {
  if (typeof v !== 'string') return false
  if (v.startsWith('blob:')) return true
  return v.startsWith('data:') && v.length > INLINE_DATA_MIN_BYTES
}

/** Returns nodes with inline-media fields removed. Untouched nodes are returned as-is. */
export function stripInlineData<T extends NodeLike>(nodes: T[]): T[] {
  let changed = false
  const out = nodes.map((node) => {
    const d = node.data
    if (!d) return node
    let hit = false
    for (const k in d) {
      if (isInlineMedia(d[k])) { hit = true; break }
    }
    if (!hit) return node
    changed = true
    const clean: Record<string, unknown> = {}
    for (const k in d) if (!isInlineMedia(d[k])) clean[k] = d[k]
    return { ...node, data: clean }
  })
  return changed ? out : nodes
}

/** Serialised save body. One place, so the autosave, the beacon and any test agree. */
export function canvasPayload(input: {
  nodes: NodeLike[]
  edges: unknown[]
  scenes: unknown[]
  activeSceneId: string
}): string {
  return JSON.stringify({
    nodes: stripInlineData(input.nodes),
    edges: input.edges,
    scenes: input.scenes,
    activeSceneId: input.activeSceneId,
  })
}
