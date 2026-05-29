'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MagnifyingGlass, Plus, ArrowLeft, User, MapPin, Package, X, UploadSimple } from '@phosphor-icons/react'

type FolderType = 'character' | 'prop' | 'location' | 'general'

interface AssetItem {
  id: string
  url: string
  isUploading?: boolean
}

interface Folder {
  id: string
  name: string
  description: string | null
  type: FolderType
  assets: { id: string; r2_url: string; type: string; prompt: string }[]
}

interface AddToFolderModalProps {
  open: boolean
  onClose: () => void
  folderType: FolderType
  // The project we're saving the folder under. Required — without it the
  // folders API silently writes everything to a default "proj-001" bucket
  // and the sidebar (which scopes its fetch by the real project id) never
  // sees them. Also required to record uploaded assets — /api/assets POST
  // rejects calls that omit projectId.
  projectId: string
  assetId?: string
  assetUrl?: string
  editFolder?: Folder | null
  // When true, open straight into the "new folder" form instead of the
  // pick-an-existing-folder list. Used by the category panel's "+ New
  // Character/Prop/…" buttons so the user doesn't have to click an extra
  // step before naming a new folder.
  defaultNew?: boolean
}

const typeLabels: Record<FolderType, string> = {
  character: 'Character',
  prop: 'Prop',
  location: 'Location',
  general: 'General',
}

const typeIcons = {
  character: User,
  prop: Package,
  location: MapPin,
  general: Package,
}

export function AddToFolderModal({ open, onClose, folderType, projectId, assetId, assetUrl, editFolder, defaultNew }: AddToFolderModalProps) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<AssetItem[]>([])
  const [creating, setCreating] = useState(false)
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [availableAssets, setAvailableAssets] = useState<{ id: string; r2_url: string; prompt: string }[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // Counter-based drag tracking. Each dragenter increments, each
  // dragleave decrements. We only flip isDraggingOver off when the
  // counter reaches zero, so child-boundary crossings don't make the
  // overlay flicker.
  const dragCountRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickerFileInputRef = useRef<HTMLInputElement>(null)

  // Fetch existing folders + available assets — both scoped to the current
  // project. Without the projectId param these endpoints either fall back
  // to a default bucket (folders) or return the whole library (assets).
  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`/api/folders?type=${folderType}&projectId=${projectId}`)
      .then(r => r.json())
      .then(data => setFolders(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))

    fetch(`/api/assets?projectId=${projectId}`)
      .then(r => r.json())
      .then(data => setAvailableAssets(Array.isArray(data) ? data : []))
      .catch(console.error)
  }, [open, folderType, projectId])

  // Initialize form
  useEffect(() => {
    if (!open) return
    if (editFolder) {
      setShowNewForm(true)
      setNewName(editFolder.name)
      setNewDescription(editFolder.description || '')
      setSelectedAssets(editFolder.assets.map(a => ({ id: a.id, url: a.r2_url })))
      return
    }
    // Category panel's "+ New Character/Prop/…" buttons set defaultNew so
    // we skip straight to the create form instead of the existing-folder list.
    if (defaultNew) {
      setShowNewForm(true)
    }
    if (assetId && assetUrl) {
      setSelectedAssets([{ id: assetId, url: assetUrl }])
      return
    }
    // Legacy reference nodes don't have data.assetId saved, so the caller
    // passes only assetUrl. Look the asset id up by URL so it can still be
    // pre-selected (and later added to a folder properly).
    if (assetUrl) {
      let cancelled = false
      fetch(`/api/assets/by-url?url=${encodeURIComponent(assetUrl)}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled || !data?.id) return
          setSelectedAssets([{ id: data.id, url: assetUrl }])
        })
        .catch(() => {})
      return () => { cancelled = true }
    }
  }, [open, editFolder, assetId, assetUrl, defaultNew])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setShowNewForm(false)
      setNewName('')
      setNewDescription('')
      setSelectedAssets([])
      setSearch('')
      setShowAssetPicker(false)
      setIsDraggingOver(false)
    }
  }, [open])

  const uploadFile = useCallback(async (file: File): Promise<AssetItem | null> => {
    const tempId = `temp-${Date.now()}-${Math.random()}`
    const tempUrl = URL.createObjectURL(file)

    // Add placeholder immediately
    setSelectedAssets(prev => [...prev, { id: tempId, url: tempUrl, isUploading: true }])

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('filename', file.name)
      const uploadRes = await fetch('/api/r2-upload', { method: 'POST', body: formData })
      if (!uploadRes.ok) throw new Error(`r2-upload returned ${uploadRes.status}`)
      const { url: r2Url } = await uploadRes.json()

      // r2-upload returns the direct R2 URL (e.g. https://bucket.account.r2.dev/...).
      // That URL isn't readable from the browser (R2 isn't public), so switch
      // it to the cookie-auth'd proxy URL like the rest of the app does —
      // otherwise the thumbnail in the modal renders as a broken image.
      const r2Key = typeof r2Url === 'string' ? r2Url.split('.r2.dev/')[1] : null
      const proxyUrl = r2Key ? `/api/r2-image/${r2Key}` : r2Url

      // Record in assets DB. projectId is REQUIRED — the API responds 400
      // without it, which used to leave the upload as a thumbnail-only
      // ghost row in selectedAssets (id: undefined) that the folder save
      // then silently dropped.
      const isVideo = file.type.startsWith('video/')
      const assetRes = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: proxyUrl, type: isVideo ? 'video' : 'image', filename: file.name, projectId }),
      })
      if (!assetRes.ok) throw new Error(`assets POST returned ${assetRes.status}`)
      const assetData = await assetRes.json()
      if (!assetData?.id) throw new Error('assets POST returned no id')

      // Replace placeholder with real asset (using proxy URL so the thumbnail
      // actually resolves), revoke the temp blob.
      URL.revokeObjectURL(tempUrl)
      setSelectedAssets(prev => prev.map(a =>
        a.id === tempId ? { id: assetData.id, url: proxyUrl, isUploading: false } : a
      ))
      setAvailableAssets(prev => [...prev, { id: assetData.id, r2_url: proxyUrl, prompt: file.name }])
      return { id: assetData.id, url: proxyUrl }
    } catch (err) {
      console.error('[v0] Upload failed:', err)
      URL.revokeObjectURL(tempUrl)
      setSelectedAssets(prev => prev.filter(a => a.id !== tempId))
      return null
    }
  }, [projectId])

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const media = Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    for (const file of media) {
      await uploadFile(file)
    }
  }, [uploadFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  const filteredFolders = folders.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleAddToExisting = async (folderId: string) => {
    if (!assetId) return
    try {
      await fetch(`/api/folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addAssetIds: [assetId] })
      })
      window.dispatchEvent(new CustomEvent('folders-changed'))
      onClose()
    } catch (err) {
      console.error('[v0] Failed to add to folder:', err)
    }
  }

  const handleSave = async () => {
    if (!newName.trim()) return

    // Fail fast (and visibly) when projectId is missing — without it the
    // folder is invisible to every other view that scopes its fetch by
    // project. Saw this manifest as "I pressed Create, nothing happened".
    if (!editFolder && !projectId) {
      toast.error("Couldn't save — no project context. Refresh the page and try again.")
      console.error('[folders] handleSave called without projectId', { folderType, newName })
      return
    }

    setCreating(true)
    try {
      const assetIds = selectedAssets
        .filter(a => !a.isUploading && a.id && !a.id.startsWith('temp-'))
        .map(a => a.id)

      console.log('[folders] save', { name: newName, type: folderType, projectId, assetIds, editing: !!editFolder })

      let res: Response
      if (editFolder) {
        res = await fetch(`/api/folders/${editFolder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null, setAssetIds: assetIds })
        })
      } else {
        res = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            description: newDescription.trim() || null,
            type: folderType,
            assetIds,
            // Required — without this the folder lands in a default
            // proj-001 bucket and never shows up in the sidebar.
            projectId,
          }),
        })
      }

      if (!res.ok) {
        const body = await res.text()
        console.error('[folders] save failed', res.status, body)
        toast.error(`Couldn't save folder (HTTP ${res.status}). Check console for details.`)
        return
      }

      toast.success(editFolder ? 'Folder updated' : `${typeLabels[folderType]} "${newName.trim()}" created`)
      window.dispatchEvent(new CustomEvent('asset-status-changed'))
      window.dispatchEvent(new CustomEvent('folders-changed'))
      onClose()
    } catch (err) {
      console.error('[folders] Save failed:', err)
      toast.error("Couldn't save folder — network or server error.")
    } finally {
      setCreating(false)
    }
  }

  const handleAddFromPicker = (asset: { id: string; r2_url: string }) => {
    if (!selectedAssets.find(a => a.id === asset.id)) {
      setSelectedAssets(prev => [...prev, { id: asset.id, url: asset.r2_url }])
    }
    setShowAssetPicker(false)
  }

  const handleRemoveAsset = (id: string) => {
    setSelectedAssets(prev => prev.filter(a => a.id !== id))
  }

  const Icon = typeIcons[folderType]
  const label = typeLabels[folderType]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        // max-h + overflow keeps the form fully visible on short screens —
        // without this the centered-fixed dialog can clip its lower half off
        // when its content (asset thumbnails, picker, etc.) is tall.
        // NOTE: do NOT add a `relative` class here — tailwind-merge would
        // overwrite the base `fixed` and the dialog would lose its centered
        // viewport positioning. `fixed` is already a positioning context
        // for the absolute-positioned drop overlay below.
        className="bg-[#1A1D21] border-white/10 max-w-md max-h-[85vh] overflow-y-auto"
        // Block every Radix auto-dismiss path. Each of these was
        // independently firing in the wild and closing the dialog:
        //   - pointerdown outside (starting a drag from the sidebar)
        //   - interact outside (broader signal Radix uses)
        //   - focus outside (OS file picker steals focus when the
        //     hidden <input type=file> click() opens, and on close
        //     focus may not return to a child of the dialog)
        // Users can still close explicitly via the built-in X button,
        // Cancel button, or Escape key.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        // Whole modal accepts drag-and-drop of files. The small "+" tile
        // also still works for direct clicks.
        //
        // CRITICAL: stopPropagation on every drag event. Radix renders this
        // dialog via portal to document.body, but React's synthetic events
        // still bubble through the COMPONENT tree — so without stopping
        // them here, every drop also fires canvas-workspace's onDrop and
        // the file gets added to the canvas as a reference node in
        // addition to landing in the folder.
        //
        // We accept three drag sources:
        //   - desktop files (dataTransfer.types.includes('Files'))
        //   - one existing asset dragged from the sidebar ('asset')
        //   - a whole folder dragged from the sidebar ('folder-assets')
        //
        // For the internal channels we MUST preventDefault on dragover
        // so the browser allows the drop — otherwise the drag preview
        // just snaps back to the source ("pop up for a second then
        // disappears").
        onDragOver={e => {
          const t = e.dataTransfer.types
          if (t.includes('Files') || t.includes('asset') || t.includes('folder-assets')) {
            // preventDefault on EVERY dragover is what tells the browser
            // "a drop is allowed here" — drop the call and the drag
            // preview snaps back to the source.
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onDragEnter={e => {
          const t = e.dataTransfer.types
          if (!(t.includes('Files') || t.includes('asset') || t.includes('folder-assets'))) return
          e.preventDefault()
          e.stopPropagation()
          dragCountRef.current++
          if (dragCountRef.current === 1) setIsDraggingOver(true)
        }}
        onDragLeave={e => {
          e.stopPropagation()
          dragCountRef.current = Math.max(0, dragCountRef.current - 1)
          if (dragCountRef.current === 0) setIsDraggingOver(false)
        }}
        onDrop={e => {
          e.preventDefault()
          e.stopPropagation()
          dragCountRef.current = 0
          setIsDraggingOver(false)

          // 1) Desktop files → upload + add.
          if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files)
            return
          }

          // 2) Single existing asset from the sidebar.
          const assetJson = e.dataTransfer.getData('asset')
          if (assetJson) {
            try {
              const a = JSON.parse(assetJson) as { id?: string; r2_url?: string }
              if (a?.id && a?.r2_url) {
                setSelectedAssets(prev => prev.find(x => x.id === a.id)
                  ? prev
                  : [...prev, { id: a.id!, url: a.r2_url! }])
              }
            } catch {}
            return
          }

          // 3) A whole folder's worth of assets at once.
          const folderJson = e.dataTransfer.getData('folder-assets')
          if (folderJson) {
            try {
              const payload = JSON.parse(folderJson) as { assets?: { id?: string; r2_url?: string }[] }
              if (Array.isArray(payload?.assets)) {
                setSelectedAssets(prev => {
                  const existingIds = new Set(prev.map(p => p.id))
                  const additions = payload.assets!
                    .filter(a => a?.id && a?.r2_url && !existingIds.has(a.id))
                    .map(a => ({ id: a.id!, url: a.r2_url! }))
                  return [...prev, ...additions]
                })
              }
            } catch {}
          }
        }}
      >
        {/* Big drop overlay (only while a file is being dragged over) */}
        {isDraggingOver && (
          <div className="pointer-events-none absolute inset-0 z-50 rounded-lg border-2 border-dashed border-accent/60 bg-accent/10 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-accent">
              <UploadSimple size={32} weight="bold" />
              <span className="text-sm font-medium">Drop to upload</span>
            </div>
          </div>
        )}

        {/* ── New / Edit form ── */}
        {showNewForm ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white font-mono">
                {!editFolder && (
                  <button onClick={() => setShowNewForm(false)} className="p-1 hover:bg-white/10 rounded">
                    <ArrowLeft size={16} />
                  </button>
                )}
                {editFolder ? `Edit ${label}` : `New ${label}`}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div>
                <label className="text-xs text-white/50 mb-1 block font-mono">Name</label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={`${label} name...`}
                  className="bg-white/5 border-white/10 font-mono text-sm"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-white/50 mb-1 block font-mono">Description</label>
                <Textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder={`Describe this ${folderType}...`}
                  className="bg-white/5 border-white/10 min-h-[72px] resize-none font-mono text-sm"
                />
              </div>

              {/* Assets section */}
              <div>
                <label className="text-xs text-white/50 mb-2 block font-mono">Assets</label>

                <div className="flex gap-2 flex-wrap">
                  {/* Drop/upload zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setIsDraggingOver(true) }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={handleDrop}
                    className={`relative w-16 h-16 border border-dashed rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                      isDraggingOver
                        ? 'border-accent bg-accent/10'
                        : 'border-white/20 hover:border-white/40 hover:bg-white/5'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => e.target.files && handleFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAssetPicker(p => !p)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-0.5"
                      title="Click to pick from library, or drop/upload files"
                    >
                      <Plus size={14} className="text-white/40" />
                    </button>
                    {/* Upload from disk sub-button */}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                      className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center"
                      title="Upload from disk"
                    >
                      <UploadSimple size={9} className="text-white/60" />
                    </button>
                  </div>

                  {/* Selected assets */}
                  {selectedAssets.map(asset => (
                    <div key={asset.id} className="relative w-16 h-16 rounded-lg overflow-hidden bg-white/5 group shrink-0">
                      <img src={asset.url} alt="" className={`w-full h-full object-cover ${asset.isUploading ? 'opacity-50' : ''}`} />
                      {asset.isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        </div>
                      )}
                      {!asset.isUploading && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAsset(asset.id)}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={9} className="text-white" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Asset picker from library */}
                {showAssetPicker && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-[#111316] p-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-white/40">Pick from library</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => pickerFileInputRef.current?.click()}
                          className="text-[10px] font-mono text-accent hover:underline flex items-center gap-1"
                        >
                          <UploadSimple size={10} /> Upload new
                        </button>
                        <button type="button" onClick={() => setShowAssetPicker(false)} className="text-white/30 hover:text-white">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                    <input
                      ref={pickerFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={e => { if (e.target.files) { handleFiles(e.target.files); setShowAssetPicker(false) } }}
                    />
                    <div className="grid grid-cols-5 gap-1.5 max-h-32 overflow-y-auto">
                      {availableAssets
                        .filter(a => !selectedAssets.find(s => s.id === a.id))
                        .map(asset => (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => handleAddFromPicker(asset)}
                            className="aspect-square rounded overflow-hidden bg-white/5 hover:ring-2 hover:ring-accent transition-all"
                          >
                            <img src={asset.r2_url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      {availableAssets.filter(a => !selectedAssets.find(s => s.id === a.id)).length === 0 && (
                        <div className="col-span-5 text-[10px] text-white/30 py-3 text-center">No more assets</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={editFolder ? onClose : () => setShowNewForm(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!newName.trim() || creating}
                  className="bg-white/10 hover:bg-white/20"
                >
                  {creating ? (editFolder ? 'Saving...' : 'Creating...') : (editFolder ? 'Save' : 'Create')}
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* ── Folder list ── */
          <>
            <DialogHeader>
              <DialogTitle className="text-white font-mono">Add to {label}</DialogTitle>
              <p className="text-xs text-white/40 font-mono mt-1">
                Add to an existing {folderType}, or create a new one.
              </p>
            </DialogHeader>

            <div className="space-y-3 mt-2">
              <Button
                variant="outline"
                className="w-full justify-center gap-2 border-white/10 hover:bg-white/5 font-mono text-sm"
                onClick={() => setShowNewForm(true)}
              >
                <Plus size={14} /> New {label}
              </Button>

              <div className="relative">
                <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${folderType}s...`}
                  className="bg-white/5 border-white/10 pl-9 font-mono text-sm"
                />
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1">
                {loading ? (
                  <div className="text-center py-8 text-white/30 text-xs font-mono">Loading...</div>
                ) : filteredFolders.length === 0 ? (
                  <div className="text-center py-8 text-white/30 text-xs font-mono">
                    {search ? 'No matches' : `No ${folderType}s yet`}
                  </div>
                ) : (
                  filteredFolders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => handleAddToExisting(folder.id)}
                      className="w-full text-left p-3 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1 shrink-0">
                          {folder.assets.slice(0, 2).map((asset, i) => (
                            <div key={i} className="w-10 h-10 rounded bg-white/5 overflow-hidden">
                              <img src={asset.r2_url} alt="" className="w-full h-full object-cover" />
                            </div>
                          ))}
                          {folder.assets.length === 0 && (
                            <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center">
                              <Icon size={14} className="text-white/20" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-white truncate">{folder.name}</div>
                          <div className="text-[10px] text-white/30 font-mono">
                            {folder.assets.length} asset{folder.assets.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
