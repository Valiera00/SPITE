// Derive a short human-readable node label from a generation prompt, so
// generated nodes auto-title themselves with something more meaningful than
// "Image Generator #3". User-renamed labels are preserved (callers compare
// the current label against the default pattern before overwriting).
export function labelFromPrompt(prompt: string, maxWords = 4): string {
  const trimmed = (prompt || '').trim()
  if (!trimmed) return ''
  // First clause keeps the label tight — strip trailing modifiers / lists.
  const firstClause = trimmed.split(/[.!?;:\n]/)[0]
  const words = firstClause.split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords).join(' ')
}

// Matches the default labels assigned by makeNode() so auto-rename only
// overwrites untouched titles.
export const DEFAULT_IMAGE_LABEL = /^Image Generator #\d+$/
export const DEFAULT_VIDEO_LABEL = /^Video Generator #\d+$/
