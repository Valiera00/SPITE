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

// Build the chip span for a mention.
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
  // contentEditable=false makes the chip behave like a single atomic unit:
  // arrow keys jump over it, backspace deletes the whole thing.
  span.contentEditable = 'false'
  const cls = COLOR[folder.type]
  span.className =
    'mention-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] border align-middle select-none cursor-pointer hover:opacity-90 ' +
    cls
  // Chip content is just the name. Icon would require nested HTML; for
  // simplicity (and to keep selection/cursor stable) we omit it from the
  // DOM and rely on color coding + the hover popover for the icon affordance.
  span.textContent = folder.name
  // Add a zero-width space after the chip so the cursor can land safely
  // immediately after it without merging into the next text node weirdly.
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

  // Full-screen asset picker (when the user clicks "Choose assets" inside
  // the popover). Same modal as the v1.
  const [picker, setPicker] = useState<{
    folderId: string
    selected: Set<string>
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

  function commitPicker() {
    if (!picker) return
    const folder = folders.find((f) => f.id === picker.folderId)
    if (!folder) return
    // Update the chip in place if it's already in the editor — otherwise
    // insert it.
    const el = editorRef.current
    const chip = el?.querySelector<HTMLElement>(`[data-mention="1"][data-folder-id="${folder.id}"]`)
    if (chip) {
      chip.dataset.assetIds = Array.from(picker.selected).join(',')
      emit()
      setPicker(null)
      setPopover(null)
      return
    }
    insertChipAtCursor(folder, picker.selected)
    setPicker(null)
    setPopover(null)
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
    setPicker(null)
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

  // ---------------- Popover ----------------

  const popoverEl = popover && typeof document !== 'undefined'
    ? (() => {
        const folder = folders.find((f) => f.id === popover.folderId)
        if (!folder) return null
        // Read the chip's current selectedAssetIds (so opening doesn't reset).
        const ids = (popover.anchor.dataset.assetIds || '').split(',').filter(Boolean)
        const rect = popover.anchor.getBoundingClientRect()
        return createPortal(
          <div
            data-mention-popover
            className="fixed z-[70] w-64 rounded-lg border border-white/10 bg-[#0E1014] shadow-xl p-2"
            style={{
              left: Math.min(rect.left, window.innerWidth - 270),
              top: Math.min(rect.bottom + 6, window.innerHeight - 200),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-white/5">
              {(() => {
                const Icon = ICONS[folder.type]
                return <Icon size={12} className="text-accent" />
              })()}
              <span className="text-[12px] text-foreground/90 truncate flex-1">{folder.name}</span>
              <span className="text-[10px] text-muted-foreground/60">
                {ids.length}/{folder.assets.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPicker({ folderId: folder.id, selected: new Set(ids) })
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 text-left"
            >
              <PencilSimple size={11} className="text-muted-foreground" />
              <span className="text-[11px] text-foreground/80">Choose assets</span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">{ids.length} selected</span>
            </button>
            <button
              type="button"
              onClick={() => removeChip(folder.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-red-500/10 text-left text-red-400 mt-0.5"
            >
              <Trash size={11} />
              <span className="text-[11px]">Remove mention</span>
            </button>
          </div>,
          document.body,
        )
      })()
    : null

  // ---------------- Asset picker modal ----------------

  const pickerModal = picker && typeof document !== 'undefined'
    ? (() => {
        const folder = folders.find((f) => f.id === picker.folderId)
        if (!folder) return null
        return createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setPicker(null)}
          >
            <div
              className="w-[480px] max-w-[92vw] rounded-xl bg-[#0E1014] border border-white/10 p-4"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{folder.name}</div>
                  <div className="text-[11px] text-muted-foreground/60 capitalize">
                    {folder.type} · {picker.selected.size} of {folder.assets.length} selected
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPicker((p) => p ? { ...p, selected: new Set(folder.assets.map((a) => a.id)) } : p)}
                    className="text-[11px] text-accent hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicker((p) => p ? { ...p, selected: new Set() } : p)}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {folder.assets.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground/50">
                  This folder is empty — add assets to it first.
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
                  {folder.assets.map((asset) => {
                    const isSel = picker.selected.has(asset.id)
                    return (
                      <button
                        type="button"
                        key={asset.id}
                        onClick={() =>
                          setPicker((p) => {
                            if (!p) return p
                            const next = new Set(p.selected)
                            if (next.has(asset.id)) next.delete(asset.id)
                            else next.add(asset.id)
                            return { ...p, selected: next }
                          })
                        }
                        className={`relative aspect-square rounded-lg overflow-hidden border transition ${
                          isSel ? 'border-accent ring-2 ring-accent/60' : 'border-white/10 hover:border-white/30'
                        }`}
                      >
                        {asset.type === 'video' ? (
                          <video src={asset.r2_url} className="w-full h-full object-cover" muted preload="metadata" />
                        ) : (
                          <img src={asset.r2_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        )}
                        {isSel && (
                          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                            <Check size={11} weight="bold" className="text-white" />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setPicker(null)}
                  className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={commitPicker}
                  disabled={picker.selected.size === 0}
                  className="px-3 py-1.5 rounded-md text-xs bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Use {picker.selected.size}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      })()
    : null

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
      {pickerModal}
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
    for (const assetId of m.selectedAssetIds) {
      const asset = folder.assets.find((a) => a.id === assetId)
      if (asset?.r2_url) out.push(asset.r2_url)
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
