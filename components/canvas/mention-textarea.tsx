'use client'

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { X, User, Package, MapPin, Folder, Check, PencilSimple, Trash } from '@phosphor-icons/react'

export type FolderType = 'character' | 'prop' | 'location' | 'general'

// One folder available for @-mention. Comes straight from /api/folders.
export interface MentionFolder {
  id: string
  name: string
  type: FolderType
  assets: { id: string; r2_url: string; type: string }[]
}

// One inserted mention: a folder + the subset of its assets the user chose.
// We keep the folder name so the @tag rendered into the text can be matched
// back to its folder even if the folder is renamed later (re-resolution by
// id wins; name is the token in the text).
export interface Mention {
  folderId: string
  name: string
  selectedAssetIds: string[]
}

export interface MentionTextareaRef {
  focus: () => void
}

interface Props {
  value: string
  mentions: Mention[]
  onChange: (text: string, mentions: Mention[]) => void
  folders: MentionFolder[]
  placeholder?: string
  className?: string
  disabled?: boolean
  rows?: number
}

const ICONS: Record<FolderType, any> = {
  character: User,
  prop: Package,
  location: MapPin,
  general: Folder,
}

const COLOR: Record<FolderType, string> = {
  character: 'bg-purple-500/20 text-purple-200 border-purple-400/40',
  prop: 'bg-blue-500/20 text-blue-200 border-blue-400/40',
  location: 'bg-green-500/20 text-green-200 border-green-400/40',
  general: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40',
}

// Folder names can have spaces; the @tag in the prompt text can't. Use
// dashes as the on-the-wire convention.
export function tagFromName(name: string): string {
  return name.replace(/\s+/g, '-')
}

// ---------------------------------------------------------------------------
// DOM <-> value serialization
//
// The editor is a contentEditable div. Each mention is rendered as a
// non-editable <span data-mention="1" data-folder-id="..." data-name="..."
// data-asset-ids="csv">. To read the value back out for the parent we walk
// the editor's child nodes, emitting `@FolderName` text for each chip span
// and the literal text for everything else.
// ---------------------------------------------------------------------------

function serializeEditor(el: HTMLElement): { text: string; mentions: Mention[] } {
  let text = ''
  const mentions: Mention[] = []
  const seen = new Set<string>()
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement
      if (e.dataset?.mention === '1') {
        const folderId = e.dataset.folderId || ''
        const name = e.dataset.name || ''
        const assetIds = (e.dataset.assetIds || '').split(',').filter(Boolean)
        text += `@${tagFromName(name)}`
        if (folderId && !seen.has(folderId)) {
          seen.add(folderId)
          mentions.push({ folderId, name, selectedAssetIds: assetIds })
        }
      } else if (e.tagName === 'BR') {
        text += '\n'
      } else {
        text += e.textContent ?? ''
      }
    }
  })
  return { text, mentions }
}

// Read DOM mentions only (without normalised text) — used inside event
// handlers where we only want the current mention IDs.
function listDomMentions(el: HTMLElement): Mention[] {
  return serializeEditor(el).mentions
}

// Build the chip span for a mention. Single text node for the folder
// name — kept atomic so caret/arrow navigation treats the whole chip
// as one unit. Selection counts are shown in the inline popover when
// the user clicks the chip.
function makeChipElement(
  folder: MentionFolder | { id: string; name: string; type: FolderType },
  selectedAssetIds: string[],
  doc: Document,
): HTMLSpanElement {
  const span = doc.createElement('span')
  span.dataset.mention = '1'
  span.dataset.folderId = folder.id
  span.dataset.name = folder.name
  span.dataset.type = folder.type
  span.dataset.assetIds = selectedAssetIds.join(',')
  span.contentEditable = 'false'
  const cls = COLOR[folder.type]
  span.className =
    'mention-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] border align-middle select-none cursor-pointer hover:opacity-90 ' +
    cls
  span.textContent = folder.name
  return span
}

function renderInitial(
  el: HTMLElement,
  value: string,
  mentions: Mention[],
  folders: MentionFolder[],
) {
  // Build segments by scanning `value` for @FolderName tokens. Each token
  // that resolves to a known folder turns into a chip; everything else is
  // plain text. We resolve folders by name (case-insensitive, dashes ←→
  // spaces) so that the parent can hand us a value+mentions snapshot
  // round-tripped from serializeEditor and we'll faithfully reproduce it.
  el.innerHTML = ''
  const re = /@([\w-]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) {
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(value.slice(lastIndex, match.index)))
    }
    const tag = match[1].replace(/-/g, ' ').toLowerCase()
    const folder =
      folders.find((f) => f.name.toLowerCase() === tag) ||
      // Allow rendering a chip for a mention whose folder hasn't been loaded
      // yet — pull the name from the mention list if any matches.
      (mentions.find((m) => m.name.toLowerCase() === tag)
        ? {
            id: mentions.find((m) => m.name.toLowerCase() === tag)!.folderId,
            name: mentions.find((m) => m.name.toLowerCase() === tag)!.name,
            type: 'general' as FolderType,
          }
        : null)
    if (folder) {
      const m =
        mentions.find((x) => x.folderId === folder.id) ||
        {
          folderId: folder.id,
          name: folder.name,
          selectedAssetIds:
            'assets' in folder ? folder.assets.map((a) => a.id) : [],
        }
      el.appendChild(makeChipElement(folder, m.selectedAssetIds, document))
    } else {
      // Unresolved tag — keep the literal text so the user can fix it.
      el.appendChild(document.createTextNode(match[0]))
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < value.length) {
    el.appendChild(document.createTextNode(value.slice(lastIndex)))
  }
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

// Find the @query the cursor is currently sitting in, scanning back from
// the caret through the current text node. Returns null if there's a
// space/newline before the next @, or no @ at all.
function findActiveAtQuery(): {
  range: Range
  query: string
  atOffset: number
  textNode: Text
} | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const textNode = node as Text
  const offset = range.startOffset
  const text = textNode.data.slice(0, offset)
  const at = text.lastIndexOf('@')
  if (at < 0) return null
  const between = text.slice(at + 1)
  if (/\s/.test(between)) return null
  return { range, query: between, atOffset: at, textNode }
}

// Place the caret at the end of `node`.
function placeCaretAfter(node: Node) {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MentionTextarea = forwardRef<MentionTextareaRef, Props>(function MentionTextarea(
  { value, mentions, onChange, folders, placeholder, className, disabled, rows = 2 },
  outerRef,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  // Whether to show the empty-state placeholder text.
  const [showPlaceholder, setShowPlaceholder] = useState(!value)

  // Hover popover state — anchored to a specific chip element.
  const [popover, setPopover] = useState<{
    anchor: HTMLElement
    folderId: string
  } | null>(null)

  useImperativeHandle(outerRef, () => ({
    focus: () => editorRef.current?.focus(),
  }))

  // Initial DOM render. We only re-render the editor from `value`+`mentions`
  // when the parent changes them out-of-band (e.g. loaded from data). Once
  // mounted, the user types and we emit onChange, but we don't sync back
  // from props — that would clobber the caret on every keystroke.
  const lastSerialized = useRef<string>('')
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    // Skip if the incoming value matches what we last emitted (parent
    // bounced our own update back). This stops the editor from being
    // re-rendered on every keystroke.
    if (value === lastSerialized.current) return
    renderInitial(el, value, mentions, folders)
    setShowPlaceholder(el.textContent === '')
    lastSerialized.current = value
    // We deliberately depend on folders too so chips can pick up their
    // proper type/colour once the SWR fetch resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mentions.length, folders.length])

  // Read the current DOM state and bubble it up.
  const emit = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const { text, mentions } = serializeEditor(el)
    lastSerialized.current = text
    setShowPlaceholder(el.textContent === '')
    onChange(text, mentions)
  }, [onChange])

  const filteredFolders = (query
    ? folders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : folders
  ).slice(0, 8)

  // Input handler — detects @query and shows the dropdown, then emits the
  // serialized value.
  const handleInput = () => {
    const q = findActiveAtQuery()
    if (q) {
      setQuery(q.query)
      setOpen(true)
      setHi(0)
    } else {
      setOpen(false)
    }
    emit()
  }

  function insertChipAtCursor(folder: MentionFolder, selected: Set<string>) {
    const q = findActiveAtQuery()
    const el = editorRef.current
    if (!el) return

    if (q) {
      // Replace the @query in the text node with a chip + trailing space.
      const before = q.textNode.data.slice(0, q.atOffset)
      const after = q.textNode.data.slice(q.atOffset + 1 + q.query.length)
      const parent = q.textNode.parentNode
      if (!parent) return
      // Split: text-before | chip | text-after (with leading space if missing)
      const chip = makeChipElement(folder, Array.from(selected), document)
      const afterText = after.startsWith(' ') ? after : ` ${after}`

      parent.insertBefore(document.createTextNode(before), q.textNode)
      parent.insertBefore(chip, q.textNode)
      parent.insertBefore(document.createTextNode(afterText), q.textNode)
      parent.removeChild(q.textNode)

      // Place caret right after the inserted chip's trailing space.
      const inserted = chip.nextSibling
      if (inserted) placeCaretAfter(inserted)
    } else {
      // No @query (user clicked the dropdown without typing) — just append
      // at the end of the editor.
      const chip = makeChipElement(folder, Array.from(selected), document)
      const space = document.createTextNode(' ')
      el.appendChild(chip)
      el.appendChild(space)
      placeCaretAfter(space)
    }

    setOpen(false)
    setQuery('')
    emit()
  }

  function removeChip(folderId: string) {
    const el = editorRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>(`[data-mention="1"][data-folder-id="${folderId}"]`).forEach((c) => {
      // Also nuke a single leading/trailing space so we don't leave a gap.
      const next = c.nextSibling
      if (next?.nodeType === Node.TEXT_NODE) {
        const t = next as Text
        if (t.data.startsWith(' ')) t.data = t.data.slice(1)
      }
      c.remove()
    })
    setPopover(null)
    emit()
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => (filteredFolders.length ? (i + 1) % filteredFolders.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => (filteredFolders.length ? (i - 1 + filteredFolders.length) % filteredFolders.length : 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const folder = filteredFolders[hi]
      if (folder) {
        e.preventDefault()
        insertChipAtCursor(folder, new Set(folder.assets.map((a) => a.id)))
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Click handler on the editor — if the user clicked a chip, open its
  // hover popover. (We do this on click instead of true hover so it sticks.)
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const chip = target.closest<HTMLElement>('[data-mention="1"]')
    if (chip) {
      e.preventDefault()
      e.stopPropagation()
      setPopover({ anchor: chip, folderId: chip.dataset.folderId || '' })
    } else {
      setPopover(null)
    }
  }

  // Close popover on outside click. (Click on chip is handled above.)
  useEffect(() => {
    if (!popover) return
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement
      if (t.closest('[data-mention-popover]')) return
      if (t.closest('[data-mention="1"]')) return
      setPopover(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [popover])

  // ---------------- Inline asset-picker popover ----------------
  //
  // Clicking a chip opens a small bar anchored to the chip itself, with
  // the folder's asset thumbnails inline. Click any thumb to toggle.
  // Changes apply immediately (no Cancel/Apply — the chip's dataset is
  // mutated in place). Remove button strips the mention entirely.

  function toggleAssetInChip(folderId: string, assetId: string, allAssetIds: string[]) {
    const el = editorRef.current
    if (!el) return
    const chip = el.querySelector<HTMLElement>(`[data-mention="1"][data-folder-id="${folderId}"]`)
    if (!chip) return
    const raw = (chip.dataset.assetIds || '').split(',').filter(Boolean)
    // Treat empty dataset.assetIds as "all" so the first toggle deselects
    // an item from the full set instead of jumping from 0/N to 1/N.
    const current = new Set(raw.length === 0 ? allAssetIds : raw)
    if (current.has(assetId)) current.delete(assetId)
    else current.add(assetId)
    chip.dataset.assetIds = Array.from(current).join(',')
    emit()
    // Force the popover to re-read the chip's dataset so the count updates.
    setPopover((p) => (p ? { ...p } : p))
  }

  const popoverEl = popover && typeof document !== 'undefined'
    ? (() => {
        const folder = folders.find((f) => f.id === popover.folderId)
        if (!folder) return null
        const rawIds = (popover.anchor.dataset.assetIds || '').split(',').filter(Boolean)
        const allIds = folder.assets.map((a) => a.id)
        // Empty selectedAssetIds means "use them all" at resolve time, so
        // reflect that in the UI: every thumb is shown selected.
        const isAll = rawIds.length === 0
        const selectedIds = new Set(isAll ? allIds : rawIds)
        const rect = popover.anchor.getBoundingClientRect()

        // 4 thumbs per row, ~64px each + gap. Anchor below the chip,
        // flipping above if there isn't room. Clamp horizontally to
        // stay on screen.
        const W = 320
        const Hest = folder.assets.length === 0 ? 110 : (Math.ceil(folder.assets.length / 4) * 68) + 110
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - W - 8))
        const placeBelow = rect.bottom + Hest + 8 < window.innerHeight
        const top = placeBelow ? rect.bottom + 6 : Math.max(8, rect.top - Hest - 6)

        const Icon = ICONS[folder.type]
        return createPortal(
          <div
            data-mention-popover
            className="fixed z-[70] rounded-lg border border-white/10 bg-[#0E1014] shadow-xl"
            style={{ left, top, width: W }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <div className={`w-5 h-5 rounded flex items-center justify-center ${COLOR[folder.type]}`}>
                <Icon size={10} weight="fill" />
              </div>
              <span className="text-[12px] text-foreground/90 truncate flex-1">{folder.name}</span>
              <span className="text-[10px] text-muted-foreground/60">
                {selectedIds.size}/{folder.assets.length}
              </span>
            </div>

            {folder.assets.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-muted-foreground/50">
                Folder is empty — add assets to it first.
              </div>
            ) : (
              <div className="p-2">
                <div className="grid grid-cols-4 gap-1.5 max-h-[260px] overflow-y-auto pr-0.5">
                  {folder.assets.map((asset) => {
                    const isSel = selectedIds.has(asset.id)
                    return (
                      <button
                        type="button"
                        key={asset.id}
                        onClick={() => toggleAssetInChip(folder.id, asset.id, allIds)}
                        className={`relative aspect-square rounded-md overflow-hidden border transition ${
                          isSel ? 'border-accent ring-1 ring-accent/60' : 'border-white/10 hover:border-white/30 opacity-50 hover:opacity-100'
                        }`}
                        title={isSel ? 'Click to deselect' : 'Click to select'}
                      >
                        {asset.type === 'video' ? (
                          <video src={asset.r2_url} className="w-full h-full object-cover" muted preload="metadata" />
                        ) : (
                          <img src={asset.r2_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        )}
                        {isSel && (
                          <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                            <Check size={9} weight="bold" className="text-white" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 px-2 pb-2">
              <button
                type="button"
                onClick={() => removeChip(folder.id)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-red-400 hover:bg-red-500/10"
              >
                <Trash size={10} />
                Remove
              </button>
              <button
                type="button"
                onClick={() => setPopover(null)}
                className="ml-auto px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )
      })()
    : null

  // (Center-screen picker modal removed — the inline popover now handles
  // asset selection right next to the chip.)

  // ---------------- Render ----------------

  const minH = `${Math.max(1, rows) * 1.4}em`

  return (
    <div className="relative">
      <div className="relative">
        {/* contentEditable surface. */}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onPaste={(e) => {
            // Paste as plain text so users can't smuggle in arbitrary HTML.
            e.preventDefault()
            const t = e.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, t)
          }}
          className={`${className || ''} whitespace-pre-wrap break-words [&_*]:select-text`}
          style={{ minHeight: minH, outline: 'none' }}
          data-mention-editor
        />
        {/* Empty-state placeholder. The contentEditable div itself can't
            host one natively, so we overlay a span. */}
        {showPlaceholder && (
          <div
            className="absolute inset-0 px-0 py-0 pointer-events-none text-muted-foreground/40 select-none"
            style={{ minHeight: minH }}
          >
            {placeholder}
          </div>
        )}
      </div>

      {/* Folder suggestion dropdown */}
      {open && filteredFolders.length > 0 && (
        <div className="absolute left-0 bottom-full mb-1 z-50 w-64 max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#0E1014] py-1 shadow-xl">
          {filteredFolders.map((f, i) => {
            const Icon = ICONS[f.type]
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => insertChipAtCursor(f, new Set(f.assets.map((a) => a.id)))}
                onMouseEnter={() => setHi(i)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left ${
                  i === hi ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                <div className={`w-5 h-5 rounded flex items-center justify-center ${COLOR[f.type]}`}>
                  <Icon size={10} weight="fill" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-foreground truncate">{f.name}</div>
                  <div className="text-[9px] text-muted-foreground/50 capitalize">
                    {f.type} · {f.assets.length} asset{f.assets.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {popoverEl}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Resolution helper used by image-node / video-node at generate time.
// Unchanged contract from the previous implementation.
// ---------------------------------------------------------------------------

export function resolveMentionRefs(
  text: string,
  mentions: Mention[],
  folders: MentionFolder[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const m of mentions) {
    if (seen.has(m.folderId)) continue
    const folder = folders.find((f) => f.id === m.folderId)
    if (!folder) continue
    seen.add(folder.id)
    // If the mention has no per-asset selection (or it captured the
    // folder while still empty), use every current asset in the folder.
    // Otherwise filter to the intersection so removed assets drop out.
    const useAll = m.selectedAssetIds.length === 0
    const idSet = new Set(m.selectedAssetIds)
    for (const asset of folder.assets) {
      if (useAll || idSet.has(asset.id)) {
        if (asset.r2_url) out.push(asset.r2_url)
      }
    }
  }

  const tagRe = /@([\w-]+)/g
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(text))) {
    const tag = match[1].replace(/-/g, ' ').toLowerCase()
    const folder = folders.find((f) => f.name.toLowerCase() === tag)
    if (folder && !seen.has(folder.id)) {
      seen.add(folder.id)
      for (const asset of folder.assets) {
        if (asset.r2_url) out.push(asset.r2_url)
      }
    }
  }
  return out
}
