import type { ModelConfig } from './fal-models'

export type FolderType = 'character' | 'prop' | 'location' | 'general'

interface MentionInput {
  folderId: string
  name: string
  selectedAssetIds: string[]
}

interface FolderInput {
  id: string
  name: string
  type: FolderType
  assets: { id: string; r2_url: string }[]
}

// Must match tagFromName in mention-textarea.tsx — collapses any run of
// non-word chars to a dash so "Elias' Horse" matches "@Elias-Horse".
function tagFromName(name: string): string {
  return name.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '')
}

const ROLE_BY_TYPE: Record<FolderType, string> = {
  character: 'character',
  prop: 'object',
  location: 'location',
  general: 'subject',
}

export interface CompiledMentions {
  prompt: string
  refs: string[]
}

// Build the prompt+refs payload for one generate call:
//  - refs[] is the ordered URL list to attach (mention order, then folder
//    asset order within each mention).
//  - prompt has each @FolderTag swapped for the binding token the target
//    model actually understands:
//      - citation-based (Kling, Seedance) → "@Image1 @Image2 …" with one
//        citation per slot so the model treats every photo as input for
//        that subject
//      - bag-of-refs (Nano Banana, FLUX) → "the character shown in
//        reference image 1" — plain English so the model can ground the
//        role to a specific image instead of guessing
// prefixRefCount accounts for refs that precede folder mentions in the
// final URL array (e.g. a connected primary image at slot 0, or wired
// `reference-in` images on the video node).
export function compileMentionsForModel(
  prompt: string,
  mentions: MentionInput[],
  folders: FolderInput[],
  model: ModelConfig | null | undefined,
  prefixRefCount = 0,
): CompiledMentions {
  const refs: string[] = []
  const positionByFolderId = new Map<
    string,
    { start: number; count: number; folder: FolderInput }
  >()
  const seen = new Set<string>()

  for (const m of mentions) {
    if (seen.has(m.folderId)) continue
    const folder = folders.find((f) => f.id === m.folderId)
    if (!folder) continue
    const useAll = m.selectedAssetIds.length === 0
    const idSet = new Set(m.selectedAssetIds)
    const urls = folder.assets
      .filter((a) => (useAll || idSet.has(a.id)) && !!a.r2_url)
      .map((a) => a.r2_url)
    if (urls.length === 0) continue
    seen.add(folder.id)
    positionByFolderId.set(folder.id, {
      start: prefixRefCount + refs.length,
      count: urls.length,
      folder,
    })
    refs.push(...urls)
  }

  // Scan text for @tags whose folder isn't in mentions[] (e.g. forwarded
  // from a connected prompt node where chip metadata wasn't carried over).
  const scanRe = /@([\w-]+)/g
  let scanMatch: RegExpExecArray | null
  while ((scanMatch = scanRe.exec(prompt))) {
    const tag = scanMatch[1].toLowerCase()
    const folder = folders.find(
      (f) => tagFromName(f.name).toLowerCase() === tag,
    )
    if (!folder || seen.has(folder.id)) continue
    const urls = folder.assets.filter((a) => !!a.r2_url).map((a) => a.r2_url)
    if (urls.length === 0) continue
    seen.add(folder.id)
    positionByFolderId.set(folder.id, {
      start: prefixRefCount + refs.length,
      count: urls.length,
      folder,
    })
    refs.push(...urls)
  }

  function citationFor(start: number, count: number, folder: FolderInput): string {
    if (model?.referenceCite) {
      return Array.from({ length: count }, (_, i) =>
        `${model.referenceCite}${start + i + 1}`,
      ).join(' ')
    }
    const role = ROLE_BY_TYPE[folder.type] || 'subject'
    if (count > 1) {
      return `the ${role} shown in reference images ${start + 1}-${start + count}`
    }
    return `the ${role} shown in reference image ${start + 1}`
  }

  const rewritten = prompt.replace(/@([\w-]+)/g, (match, tag) => {
    const tagLower = (tag as string).toLowerCase()
    const folder = folders.find(
      (f) => tagFromName(f.name).toLowerCase() === tagLower,
    )
    if (!folder) return match
    const pos = positionByFolderId.get(folder.id)
    if (!pos) return match
    return citationFor(pos.start, pos.count, pos.folder)
  })

  return { prompt: rewritten, refs }
}
