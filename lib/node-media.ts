// Single source of truth for "what image/video does this node actually hold?"
//
// Node types store their media under different keys depending on how they got
// it: generated nodes use `outputUrl`, uploads/reference nodes use `thumbnail`
// or `assetUrl`, video nodes additionally carry `videoThumbnail` (a poster
// frame). Input-collection code that only checked a subset silently dropped
// connected references — the edge looked attached, but nothing was sent to the
// model, so you paid for a generation that ignored your reference. Every
// consumer must resolve through here so that can't drift again.

type NodeData = Record<string, unknown> | undefined | null

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/**
 * The media URL a node can hand downstream, or undefined if it has none yet
 * (e.g. a generator that hasn't run, or an upload still in flight).
 */
export function resolveNodeMediaUrl(data: NodeData): string | undefined {
  if (!data) return undefined
  const d = data as Record<string, unknown>
  // Prefer a real output; fall back to upload/reference fields. `videoThumbnail`
  // is last: it's a poster frame, only useful when nothing else exists.
  return (
    str(d.outputUrl) ??
    str(d.assetUrl) ??
    str(d.thumbnail) ??
    str(d.imageUrl) ??
    str(d.videoThumbnail)
  )
}

/** True when the node currently has nothing to hand downstream. */
export function nodeHasNoMedia(data: NodeData): boolean {
  return resolveNodeMediaUrl(data) === undefined
}
