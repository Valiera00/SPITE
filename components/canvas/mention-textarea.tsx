'use client'

import {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { X, User, Package, MapPin, Folder, Check } from '@phosphor-icons/react'

export type FolderType = 'character' | 'prop' | 'location' | 'general'

// One folder available for @-mention. Comes straight from /api/folders.
export interface MentionFolder {
  id: string
  name: string
  type: FolderType
  assets: { id: string; r2_url: string; type: string }[]
}

// One inserted mention: a folder + the subset of its assets the user chose
// at insert time. Stored on the node and used at generate-time to attach
// reference images. We keep the folder name so the @tag in the text can
// be matched back to its folder even if the folder is renamed later
// (re-resolution by id wins; name is the in-text token).
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
  character: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  prop: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  location: 'bg-green-500/20 text-green-300 border-green-500/30',
  general: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
}

// Folder names can have spaces; the @tag in the text can't. Use dashes as
// the on-the-wire convention. Resolution is also case-insensitive at parse
// time, so casing in the prompt doesn't matter.
export function tagFromName(name: string): string {
  return name.replace(/\s+/g, '-')
}

export const MentionTextarea = forwardRef<MentionTextareaRef, Props>(function MentionTextarea(
  { value, mentions, onChange, folders, placeholder, className, disabled, rows = 2 },
  outerRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  // When non-null, the asset-picker popover is showing for this folder.
  const [picker, setPicker] = useState<{
    folder: MentionFolder
    selected: Set<string>
    // The cursor at the time the picker opened — we re-target this when
    // committing the pick, in case the user typed elsewhere meanwhile.
    insertAt: number
    insertEnd: number
  } | null>(null)

  useImperativeHandle(outerRef, () => ({
    focus: () => textareaRef.current?.focus(),
  }))

  const matches = (query
    ? folders.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : folders
  ).slice(0, 8)

  // After any text edit, drop mentions whose @tag no longer appears.
  function syncMentions(text: string): Mention[] {
    return mentions.filter((m) => text.includes(`@${tagFromName(m.name)}`))
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const newText = e.target.value
    const cursor = e.target.selectionStart
    const before = newText.slice(0, cursor)
    const atIdx = before.lastIndexOf('@')
    const hasSpaceAfterAt = atIdx >= 0 && /\s/.test(before.slice(atIdx + 1))
    if (atIdx >= 0 && !hasSpaceAfterAt) {
      setQuery(before.slice(atIdx + 1))
      setOpen(true)
      setHi(0)
    } else {
      setOpen(false)
    }
    onChange(newText, syncMentions(newText))
  }

  function pickFolder(folder: MentionFolder) {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const before = value.slice(0, cursor)
    const atIdx = before.lastIndexOf('@')
    setPicker({
      folder,
      // All selected by default; user can fine-tune via the popover.
      selected: new Set(folder.assets.map((a) => a.id)),
      insertAt: atIdx >= 0 ? atIdx : cursor,
      insertEnd: cursor,
    })
    setOpen(false)
  }

  function commitPick() {
    if (!picker) return
    const { folder, selected, insertAt, insertEnd } = picker
    const tag = `@${tagFromName(folder.name)}`
    const newText = value.slice(0, insertAt) + tag + ' ' + value.slice(insertEnd)
    const newMentions: Mention[] = [
      ...mentions.filter((m) => m.folderId !== folder.id),
      { folderId: folder.id, name: folder.name, selectedAssetIds: Array.from(selected) },
    ]
    onChange(newText, newMentions)
    setPicker(null)
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      const pos = insertAt + tag.length + 1
      ta.selectionStart = ta.selectionEnd = pos
      ta.focus()
    })
  }

  function editExistingMention(m: Mention) {
    const folder = folders.find((f) => f.id === m.folderId)
    if (!folder) return
    setPicker({
      folder,
      selected: new Set(m.selectedAssetIds),
      // No text replacement needed — we'll patch the mention in place.
      insertAt: -1,
      insertEnd: -1,
    })
  }

  function commitEdit() {
    if (!picker || picker.insertAt !== -1) return commitPick()
    const newMentions = mentions.map((m) =>
      m.folderId === picker.folder.id ? { ...m, selectedAssetIds: Array.from(picker.selected) } : m,
    )
    onChange(value, newMentions)
    setPicker(null)
  }

  function removeMention(m: Mention) {
    const tag = `@${tagFromName(m.name)}`
    // Strip every occurrence of the tag (and a trailing space if present)
    // and collapse the resulting double-spaces.
    const cleaned = value
      .split(new RegExp(`${tag}\\s?`, 'g'))
      .join('')
      .replace(/[ \t]{2,}/g, ' ')
    onChange(cleaned, mentions.filter((x) => x.folderId !== m.folderId))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => (matches.length ? (i + 1) % matches.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (matches[hi]) {
        e.preventDefault()
        pickFolder(matches[hi])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Asset picker modal — portal'd to body so it isn't clipped by React Flow's
  // transformed node container.
  const pickerModal = picker && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPicker(null)}
        >
          <div
            className="w-[480px] max-w-[92vw] rounded-xl bg-[#0E1014] border border-white/10 p-4"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-foreground">{picker.folder.name}</div>
                <div className="text-[11px] text-muted-foreground/60 capitalize">
                  {picker.folder.type} · {picker.selected.size} of {picker.folder.assets.length} selected
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPicker((p) =>
                      p ? { ...p, selected: new Set(p.folder.assets.map((a) => a.id)) } : p,
                    )
                  }
                  className="text-[11px] text-accent hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setPicker((p) => (p ? { ...p, selected: new Set() } : p))}
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            {picker.folder.assets.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground/50">
                This folder is empty — add assets to it first.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
                {picker.folder.assets.map((asset) => {
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
                        <img
                          src={asset.r2_url}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
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
                onClick={commitEdit}
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
    : null

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={className}
      />

      {/* Mention chips */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {mentions.map((m) => {
            const folder = folders.find((f) => f.id === m.folderId)
            const type = folder?.type || 'general'
            const Icon = ICONS[type]
            const total = folder?.assets.length || 0
            const sel = m.selectedAssetIds.length
            return (
              <span
                key={m.folderId}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${COLOR[type]}`}
              >
                <Icon size={10} weight="fill" />
                <button
                  type="button"
                  onClick={() => editExistingMention(m)}
                  className="hover:underline"
                  title="Pick which assets to use"
                >
                  {m.name}
                  {total > 0 && <span className="opacity-70"> ({sel}/{total})</span>}
                </button>
                <button
                  type="button"
                  onClick={() => removeMention(m)}
                  className="ml-0.5 hover:opacity-70"
                  title="Remove mention"
                >
                  <X size={9} weight="bold" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {/* Folder dropdown */}
      {open && matches.length > 0 && (
        <div className="absolute left-0 bottom-full mb-1 z-50 w-64 max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#0E1014] py-1 shadow-xl">
          {matches.map((f, i) => {
            const Icon = ICONS[f.type]
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => pickFolder(f)}
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

      {pickerModal}
    </div>
  )
})

// Resolve every folder-mention in a prompt + explicit mentions array into
// the list of r2_urls that should be attached as references at generate
// time. Local `mentions` (with a user-picked subset) take precedence; tags
// that only appear in the text (e.g. forwarded by a prompt node) fall back
// to "use all assets in the matched folder".
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
