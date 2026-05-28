'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import useSWR from 'swr'
import { AddToFolderModal } from './add-to-folder-modal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Plus,
  Scissors,
  Smiley,
  ChatCircle,
  ArrowCounterClockwise,
  ArrowClockwise,
  Gear,
  User,
  Package,
  MapPin,
  Folder,
  MagnifyingGlass,
  X,
  CaretDown,
  CaretRight,
  UploadSimple,
  Image as ImageIcon,
  DotsThree,
  Trash,
  Tag,
  ClockCounterClockwise,
  Copy,
  Download,
  VideoCamera,
  ShieldCheck,
  ArrowsOut,
  Cursor,
  Check,
} from '@phosphor-icons/react'

export type AssetCategory = 'characters' | 'props' | 'locations' | 'general'

export interface Asset {
  id: string
  name: string
  category: AssetCategory
  url: string
  thumbnail?: string
  tags?: string[]
  metadata?: any
}

const TOOLS = [
  { id: 'select', icon: Cursor, label: 'Select' },
  { id: 'add', icon: Plus, label: 'Add node' },
  { id: 'cut', icon: Scissors, label: 'Cut connections' },
  { id: 'sticker', icon: Smiley, label: 'Add sticker' },
  { id: 'comment', icon: ChatCircle, label: 'Add comment' },
] as const

const ASSET_CATEGORIES: { id: AssetCategory; icon: typeof User; label: string; color: string }[] = [
  { id: 'characters', icon: User, label: 'Characters', color: 'text-purple-400' },
  { id: 'props', icon: Package, label: 'Props', color: 'text-blue-400' },
  { id: 'locations', icon: MapPin, label: 'Locations', color: 'text-green-400' },
  { id: 'general', icon: Folder, label: 'General', color: 'text-yellow-400' },
]

interface GeneratedAsset {
  id: string
  type: 'image' | 'video'
  model: string
  prompt: string
  r2_url: string
  used_in_canvas: boolean
  is_upload: boolean
  created_at: string
}

interface LeftToolbarProps {
  onAddNode?: (type: string) => void
  onSetTool?: (tool: 'select' | 'cut' | 'sticker' | 'comment') => void
  activeTool?: string
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  assets?: Asset[]
  onAssetsChange?: (assets: Asset[]) => void
  onSelectAsset?: (asset: Asset) => void
  projectId: string
  showHistory?: boolean
  onShowHistoryChange?: (show: boolean) => void
}

export function LeftToolbar({ 
  onAddNode, 
  onSetTool,
  activeTool: externalActiveTool,
  onUndo, 
  onRedo,
  canUndo = true,
  canRedo = true,
  assets = [],
  onAssetsChange,
  onSelectAsset,
  projectId,
  showHistory = false,
  onShowHistoryChange,
}: LeftToolbarProps) {
  const [localActiveTool, setLocalActiveTool] = useState<string | null>(null)
  const activeTool = externalActiveTool || localActiveTool
  const [expanded, setExpanded] = useState(false)
  const [expandedCategory, setExpandedCategory] = useState<AssetCategory | null>(null)
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [showTagsModal, setShowTagsModal] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [historyOpen, setHistoryOpen] = useState(showHistory)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'image' | 'video' | 'uploads'>('all')
  const [historySearch, setHistorySearch] = useState('')
  const [selectedGenAsset, setSelectedGenAsset] = useState<GeneratedAsset | null>(null)
  const [sidebarSection, setSidebarSection] = useState<'history' | 'uploads'>('history')
  const [expandedFolderSections, setExpandedFolderSections] = useState<Record<string, boolean>>({
    character: true,
    prop: true,
    location: true,
    general: true,
  })
  const [selectedFolder, setSelectedFolder] = useState<{ id: string; type: string } | null>(null)
  const [editingFolder, setEditingFolder] = useState<{
    id: string
    name: string
    description: string | null
    type: 'character' | 'prop' | 'location' | 'general'
    assets: { id: string; r2_url: string; type: string; prompt: string }[]
  } | null>(null)

  // Bulk-select state for the assets panel (works in both compact + expanded
  // views). selectedIds is a Set keyed by generation_history.id.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const expandedUploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHistoryOpen(showHistory)
  }, [showHistory])

  const fetcher = (url: string) => fetch(url).then(r => r.json()).then(d => Array.isArray(d) ? d : [])
  const { data: generatedAssets = [], isLoading: loadingHistory, mutate: mutateAssets } = useSWR<GeneratedAsset[]>(
    historyOpen ? `/api/assets?projectId=${projectId}` : null,
    fetcher,
    { refreshInterval: 3000, revalidateOnFocus: true }
  )

  // Fetch folders (characters, props, locations) - filtered by project
  const { data: folders = [], mutate: mutateFolders } = useSWR<{
    id: string
    name: string
    description: string | null
    type: 'character' | 'prop' | 'location' | 'general'
    assets: { id: string; r2_url: string; type: string; prompt: string }[]
  }[]>(
    historyOpen ? `/api/folders?projectId=${projectId}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: true }
  )
  
  // Listen for folder changes
  useEffect(() => {
    const handleFoldersChanged = () => mutateFolders()
    window.addEventListener('folders-changed', handleFoldersChanged)
    return () => window.removeEventListener('folders-changed', handleFoldersChanged)
  }, [mutateFolders])
  
  // Group folders by type
  const characterFolders = useMemo(() => folders.filter(f => f.type === 'character'), [folders])
  const propFolders = useMemo(() => folders.filter(f => f.type === 'prop'), [folders])
  const locationFolders = useMemo(() => folders.filter(f => f.type === 'location'), [folders])
  
  // Keep selectedGenAsset in sync with latest data from SWR
  useEffect(() => {
    if (selectedGenAsset) {
      const updated = generatedAssets.find(a => a.id === selectedGenAsset.id)
      if (updated) setSelectedGenAsset(updated)
    }
  }, [generatedAssets])

  // Listen for asset status changes (from canvas node deletion)
  useEffect(() => {
    const handleAssetStatusChange = () => mutateAssets()
    window.addEventListener('asset-status-changed', handleAssetStatusChange)
    return () => window.removeEventListener('asset-status-changed', handleAssetStatusChange)
  }, [mutateAssets])

  const filteredGenAssets = useMemo(() => {
    return generatedAssets.filter(a => {
      const matchSearch = !historySearch || 
        a.prompt.toLowerCase().includes(historySearch.toLowerCase()) ||
        a.model.toLowerCase().includes(historySearch.toLowerCase())
      const matchFilter = historyFilter === 'all' ||
        (historyFilter === 'image' && a.type === 'image') ||
        (historyFilter === 'video' && a.type === 'video') ||
        (historyFilter === 'uploads' && a.is_upload)
      return matchSearch && matchFilter
    })
  }, [generatedAssets, historySearch, historyFilter])

  const groupedGenAssets = useMemo(() => {
    const groups: Record<string, GeneratedAsset[]> = {}
    filteredGenAssets.forEach(asset => {
      const date = new Date(asset.created_at)
      const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!groups[key]) groups[key] = []
      groups[key].push(asset)
    })
    return groups
  }, [filteredGenAssets])

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    })
  }

  const filteredAssets = search.trim()
    ? assets.filter(a => 
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : assets

  const getAssetsByCategory = (category: AssetCategory) => 
    filteredAssets.filter(a => a.category === category)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !expandedCategory) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', file.name.replace(/\.[^/.]+$/, ''))
      formData.append('category', expandedCategory)

      const response = await fetch(`/api/projects/${projectId}/assets/upload`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const newAsset = await response.json()
        const updatedAssets = [...assets, newAsset]
        onAssetsChange?.(updatedAssets)
      }
    } catch (error) {
      console.error('[v0] Upload error:', error)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteAsset = async (asset: Asset) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/upload`, {
        method: 'DELETE',
        body: JSON.stringify({
          assetId: asset.id,
          filename: asset.metadata?.filename,
        }),
      })

      if (response.ok) {
        const updatedAssets = assets.filter(a => a.id !== asset.id)
        onAssetsChange?.(updatedAssets)
      }
    } catch (error) {
      console.error('[v0] Delete error:', error)
    }
  }

  const handleToggleHistory = () => {
    const newState = !historyOpen
    setHistoryOpen(newState)
    setHistoryExpanded(false)
    setExpanded(false)
    onShowHistoryChange?.(newState)
  }

  const handleCloseHistory = () => {
    setHistoryOpen(false)
    setHistoryExpanded(false)
    onShowHistoryChange?.(false)
  }

  // Bulk-select helpers.
  const toggleAssetSelected = (id: string) => {
    setSelectedAssetIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllVisible = () => {
    setSelectedAssetIds(new Set(filteredGenAssets.map(a => a.id)))
  }
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedAssetIds(new Set())
  }
  const enterSelectMode = () => {
    setSelectMode(true)
    setSelectedAssetIds(new Set())
    setSelectedGenAsset(null)
  }

  // Run the delete for every selected id in parallel. The single-asset
  // /api/assets/[id] endpoint returns 403 for canvas-protected assets;
  // we count those as "skipped" rather than failures so the user knows
  // why a number didn't drop from the panel.
  const performBulkDelete = async () => {
    if (selectedAssetIds.size === 0) return
    setBulkDeleting(true)
    const ids = Array.from(selectedAssetIds)
    const results = await Promise.all(
      ids.map(id =>
        fetch(`/api/assets/${id}`, { method: 'DELETE' })
          .then(r => ({ id, status: r.status }))
          .catch(() => ({ id, status: 0 }))
      )
    )
    setBulkDeleting(false)
    setBulkDeleteOpen(false)

    const deleted = results.filter(r => r.status >= 200 && r.status < 300).length
    const protectedCount = results.filter(r => r.status === 403).length
    const failed = results.length - deleted - protectedCount

    mutateAssets()
    exitSelectMode()

    if (deleted > 0) toast.success(`Deleted ${deleted} asset${deleted !== 1 ? 's' : ''}`)
    if (protectedCount > 0) toast.warning(`${protectedCount} skipped — still used on a canvas`)
    if (failed > 0) toast.error(`${failed} failed to delete`)
  }


  // EXPANDED FULL-SCREEN ASSETS MODAL
  if (historyOpen && historyExpanded) {
    return (
      <>
        {/* Bulk-delete confirmation — Radix portals it, location is moot. */}
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent className="bg-[#0D0F12] border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedAssetIds.size} asset{selectedAssetIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes them from storage and the asset library. Any selected assets currently used on a canvas are skipped — clear them off the canvas first if you want them gone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10" disabled={bulkDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30"
                disabled={bulkDeleting}
                onClick={performBulkDelete}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selectedAssetIds.size}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/90 z-40"
          onClick={handleCloseHistory}
        />
        
        {/* Modal */}
        <div className="fixed inset-8 z-50 bg-card rounded-2xl border border-border/30 flex overflow-hidden shadow-2xl">
          {/* Left Sidebar */}
          <div className="w-56 border-r border-border/30 flex flex-col bg-card">
            <div className="px-4 py-3 border-b border-border/30">
              <span className="text-xs font-mono text-muted-foreground/60 uppercase tracking-wider">Creations</span>
            </div>

            {/* Navigation. Filter tabs in the header switch between
                image/video/uploads; this side-nav just toggles whether
                generations or uploads come first conceptually — both
                feeds use the same filteredGenAssets list. */}
            <div className="flex-1 px-2 py-2 overflow-y-auto">
              <button
                onClick={() => { setHistoryFilter('all'); setSidebarSection('history') }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  sidebarSection === 'history' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <ClockCounterClockwise size={16} />
                History
              </button>
              <button
                onClick={() => { setHistoryFilter('uploads'); setSidebarSection('uploads') }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  sidebarSection === 'uploads' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <UploadSimple size={16} />
                Uploads
              </button>

              {/* Folders — always-visible category sections (Characters /
                  Props / Locations / General), each collapsible. Inside,
                  every folder gets a mini thumbnail of its first asset for
                  quick visual ID, plus a count. Items inside any folder
                  are auto-protected (the folders API sets
                  used_in_canvas=true, expires_at=NULL on every add), so
                  they survive cleanup until you delete them yourself. */}
              <div className="mt-4 pt-4 border-t border-border/30 space-y-1">
                <div className="px-3 pb-1 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Folders</span>
                  <span className="text-[10px] text-muted-foreground/40">{folders.length}</span>
                </div>
                {(['character', 'prop', 'location', 'general'] as const).map(t => {
                  const ofType = folders.filter(f => f.type === t)
                  const Icon = t === 'character' ? User : t === 'prop' ? Package : t === 'location' ? MapPin : Folder
                  const label = t === 'character' ? 'Characters' : t === 'prop' ? 'Props' : t === 'location' ? 'Locations' : 'General'
                  const isOpen = expandedFolderSections[t]
                  return (
                    <div key={t}>
                      <button
                        onClick={() => setExpandedFolderSections(s => ({ ...s, [t]: !s[t] }))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors group"
                      >
                        {isOpen ? <CaretDown size={9} className="text-muted-foreground/60" /> : <CaretRight size={9} className="text-muted-foreground/60" />}
                        <Icon size={12} className="text-accent" />
                        <span className="text-[11px] text-foreground/80 group-hover:text-foreground tracking-wide flex-1 text-left">{label}</span>
                        <span className="text-[10px] text-muted-foreground/50">{ofType.length}</span>
                      </button>
                      {isOpen && (
                        <div className="pl-2 mt-0.5 space-y-0.5">
                          {ofType.length === 0 ? (
                            <div className="px-3 py-1.5 text-[10px] text-muted-foreground/30 italic">
                              No {label.toLowerCase()} yet
                            </div>
                          ) : (
                            ofType.map(f => (
                              <button
                                key={f.id}
                                onClick={() => setEditingFolder(f)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors text-left"
                                title="Edit folder"
                              >
                                <div className="w-7 h-7 rounded overflow-hidden bg-card border border-border/30 shrink-0 flex items-center justify-center">
                                  {f.assets[0]?.r2_url ? (
                                    <img
                                      src={f.assets[0].r2_url}
                                      alt=""
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <Icon size={11} className="text-muted-foreground/30" />
                                  )}
                                </div>
                                <span className="flex-1 truncate text-[12px] text-foreground/80">{f.name}</span>
                                <span className="text-[10px] text-muted-foreground/50 shrink-0">{f.assets.length}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/30 gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-foreground">
                  {sidebarSection === 'uploads' ? 'Uploads' : 'History'}
                </h2>
                {/* Filter tabs — same as compact view */}
                <div className="flex gap-1">
                  {(['all', 'image', 'video', 'uploads'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setHistoryFilter(filter)}
                      className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                        historyFilter === filter
                          ? 'bg-accent/20 text-accent'
                          : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                      }`}
                    >
                      {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-input border border-border/50 w-64">
                  <MagnifyingGlass size={14} className="text-muted-foreground/60" />
                  <input
                    type="text"
                    placeholder="Search"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
                  />
                </div>
                {/* Select-mode toggle */}
                {!selectMode ? (
                  <button
                    onClick={enterSelectMode}
                    className="px-3 py-2 rounded-lg border border-border/50 text-sm text-foreground hover:bg-white/5 transition-colors"
                  >
                    Select
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground/70">
                      {selectedAssetIds.size} selected
                    </span>
                    <button
                      onClick={selectAllVisible}
                      className="px-3 py-1.5 rounded-md text-xs text-foreground hover:bg-white/5 transition-colors"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setBulkDeleteOpen(true)}
                      disabled={selectedAssetIds.size === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash size={12} />
                      Delete
                    </button>
                    <button
                      onClick={exitSelectMode}
                      className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Grid Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-24">
                  <span className="text-sm font-mono text-muted-foreground/50">Loading...</span>
                </div>
              ) : Object.keys(groupedGenAssets).length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-24 text-center">
                  <ClockCounterClockwise size={48} className="text-muted-foreground/30" />
                  <span className="text-sm font-mono text-muted-foreground/50">No generations yet</span>
                </div>
              ) : (
                Object.entries(groupedGenAssets).map(([monthYear, monthAssets]) => (
                  <div key={monthYear} className="mb-6">
                    <h3 className="text-sm text-muted-foreground/60 mb-3">
                      {monthYear}
                    </h3>
                    <div className="grid grid-cols-7 gap-3">
                      {monthAssets.map(asset => {
                        const isSel = selectedAssetIds.has(asset.id)
                        return (
                          <button
                            key={asset.id}
                            onClick={() => {
                              if (selectMode) toggleAssetSelected(asset.id)
                              else setSelectedGenAsset(asset)
                            }}
                            className={`relative aspect-square rounded-lg overflow-hidden bg-card border transition-all group ${
                              isSel
                                ? 'border-accent ring-2 ring-accent/60'
                                : 'border-border/30 hover:border-accent/50 hover:scale-[1.02]'
                            }`}
                          >
                            {asset.type === 'video' ? (
                              <video src={asset.r2_url} className="w-full h-full object-cover" muted preload="metadata" />
                            ) : (
                              <img src={asset.r2_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            )}
                            <div className="absolute top-2 left-2 flex gap-1">
                              {asset.type === 'video' && (
                                <div className="w-5 h-5 rounded bg-black/60 flex items-center justify-center">
                                  <VideoCamera size={12} className="text-white" />
                                </div>
                              )}
                              {asset.used_in_canvas && (
                                <div className="w-5 h-5 rounded bg-accent/80 flex items-center justify-center">
                                  <ShieldCheck size={12} className="text-white" />
                                </div>
                              )}
                            </div>
                            {/* Selection checkmark */}
                            {selectMode && (
                              <div className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${
                                isSel
                                  ? 'bg-accent border-accent text-white'
                                  : 'bg-black/60 border-white/30 text-transparent'
                              }`}>
                                <Check size={14} weight="bold" />
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Detail Panel */}
          <div className="w-72 border-l border-border/30 flex flex-col bg-card">
            {/* Close button */}
            <div className="flex justify-end px-4 py-3">
              <button
                onClick={handleCloseHistory}
                className="w-10 h-10 rounded-full flex items-center justify-center bg-card border border-border/30 hover:bg-white/10 text-foreground transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {selectedGenAsset ? (
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {/* Preview */}
                <div className="rounded-lg overflow-hidden bg-card border border-border/30 mb-4 aspect-video">
                  {selectedGenAsset.type === 'video' ? (
                    <video src={selectedGenAsset.r2_url} controls className="w-full h-full object-cover" preload="metadata" />
                  ) : (
                    <img src={selectedGenAsset.r2_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  )}
                </div>

                {/* Metadata — only the fields we actually have. The earlier
                    placeholders (Workflow name / Resolution / Seed) were
                    hardcoded strings and would have lied to the user. */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between text-muted-foreground/60">
                    <span>Type</span>
                    <span className="text-foreground capitalize">{selectedGenAsset.type}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground/60">
                    <span>Date Created</span>
                    <span className="text-foreground">{formatDate(selectedGenAsset.created_at)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground/60">
                    <span>AI Model</span>
                    <span className="text-foreground">{selectedGenAsset.model.split('/').pop() || '—'}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground/60">
                    <span>Status</span>
                    <span className={selectedGenAsset.used_in_canvas ? 'text-accent' : 'text-muted-foreground'}>
                      {selectedGenAsset.used_in_canvas ? 'Protected' : 'Temporary'}
                    </span>
                  </div>
                </div>

                {/* Prompt */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground/60 uppercase">Prompt</span>
                    <button
                      onClick={() => copyPrompt(selectedGenAsset.prompt)}
                      className="flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                  <p className="text-sm text-foreground/80 bg-card rounded-lg p-3 border border-border/30 leading-relaxed">
                    {selectedGenAsset.prompt}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin + selectedGenAsset.r2_url)
                      toast.success('Asset URL copied')
                    }}
                    className="flex-1 px-4 py-2 rounded-lg border border-border/30 text-sm text-foreground hover:bg-white/5 transition-colors"
                  >
                    Copy link
                  </button>
                  <a
                    href={selectedGenAsset.r2_url}
                    download
                    className="flex-1 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors text-center"
                  >
                    Download
                  </a>
                </div>
                {/* Delete */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/15 text-red-400 text-sm hover:bg-red-500/25 transition-colors">
                      <Trash size={14} />
                      Delete permanently
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#0D0F12] border-white/10">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Permanently delete asset?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the file from storage and history. Assets currently used on a canvas are skipped (mark the node as unused first).
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30"
                        onClick={async () => {
                          const currentIndex = filteredGenAssets.findIndex(a => a.id === selectedGenAsset.id)
                          const nextAsset = filteredGenAssets[currentIndex + 1] ?? filteredGenAssets[currentIndex - 1] ?? null
                          const res = await fetch(`/api/assets/${selectedGenAsset.id}`, { method: 'DELETE' })
                          if (res.ok) {
                            mutateAssets()
                            setSelectedGenAsset(nextAsset ?? null)
                            toast.success('Asset deleted')
                          } else if (res.status === 403) {
                            toast.warning('Asset is still used on the canvas')
                          } else {
                            toast.error('Failed to delete')
                          }
                        }}
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
                <p className="text-sm text-muted-foreground/50 mb-4">
                  Drop an image or upload<br />your own media
                </p>
                <button
                  onClick={() => expandedUploadRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/30 text-sm text-foreground hover:bg-white/5"
                >
                  <UploadSimple size={16} />
                  Upload media
                </button>
                <input
                  ref={expandedUploadRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const formData = new FormData()
                    formData.append('file', file)
                    formData.append('filename', file.name)
                    try {
                      const up = await fetch('/api/r2-upload', { method: 'POST', body: formData })
                      const j = await up.json()
                      if (!j.url) throw new Error('upload failed')
                      const r2Key = j.url.split('.r2.dev/')[1]
                      const proxyUrl = r2Key ? `/api/r2-image/${r2Key}` : j.url
                      await fetch('/api/assets', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          url: proxyUrl,
                          type: file.type.startsWith('video/') ? 'video' : 'image',
                          filename: file.name.replace(/\.[^.]+$/, ''),
                          projectId,
                        }),
                      })
                      mutateAssets()
                      toast.success('Upload added to library')
                    } catch (err) {
                      console.error('[uploads] failed', err)
                      toast.error('Upload failed')
                    } finally {
                      if (expandedUploadRef.current) expandedUploadRef.current.value = ''
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // COMPACT ASSETS PANEL VIEW (current sidebar panel)
  if (historyOpen) {
    return (
      <div className="absolute left-3 top-3 bottom-3 z-20 glass rounded-2xl w-80 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="text-sm font-semibold text-foreground">Assets</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={selectMode ? exitSelectMode : enterSelectMode}
              className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                selectMode
                  ? 'bg-accent/20 text-accent'
                  : 'hover:bg-white/10 text-muted-foreground hover:text-foreground'
              }`}
              title={selectMode ? 'Exit select mode' : 'Select multiple'}
            >
              <Check size={12} weight="bold" />
            </button>
            <button
              onClick={() => setHistoryExpanded(true)}
              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title="Expand"
            >
              <ArrowsOut size={14} />
            </button>
            <button
              onClick={handleCloseHistory}
              className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border/30">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-input border border-border/50">
            <MagnifyingGlass size={12} className="text-muted-foreground/60" />
            <input
              type="text"
              placeholder="Search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/40 outline-none"
            />
            {historySearch && (
              <button onClick={() => setHistorySearch('')} className="text-muted-foreground hover:text-foreground">
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 py-2 border-b border-border/30">
          {(['all', 'image', 'video', 'uploads'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setHistoryFilter(filter)}
              className={`flex-1 px-2 py-1.5 rounded text-xs font-mono transition-colors ${
                historyFilter === filter
                  ? 'bg-accent/20 text-accent'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>

        {/* Main content - grid or detail */}
        <div className="flex-1 overflow-hidden flex">
          {/* Grid */}
          {!selectedGenAsset ? (
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {/* Folder sections - Characters, Props, Locations */}
              {historyFilter === 'all' && (
                <>
                  {/* Characters */}
                  {characterFolders.length > 0 && (
                    <div className="mb-4">
                      <button
                        onClick={() => setExpandedFolderSections(s => ({ ...s, character: !s.character }))}
                        className="flex items-center gap-2 w-full text-left px-2 mb-2"
                      >
                        {expandedFolderSections.character ? <CaretDown size={10} /> : <CaretRight size={10} />}
                        <User size={12} className="text-accent" />
                        <span className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Characters</span>
                        <span className="text-[10px] text-muted-foreground/40 ml-auto">{characterFolders.length}</span>
                      </button>
                      {expandedFolderSections.character && (
                        <div className="grid grid-cols-3 gap-2 pl-2">
                          {characterFolders.map(folder => (
                            <button
                              key={folder.id}
                              onClick={() => setEditingFolder(folder)}
                              className="text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                            >
                              <div className="flex gap-1 mb-1.5">
                                {folder.assets.slice(0, 2).map((asset, i) => (
                                  <div key={i} className="w-8 h-8 rounded bg-white/5 overflow-hidden">
                                    <img src={asset.r2_url} alt="" className="w-full h-full object-cover" />
                                  </div>
                                ))}
                                {folder.assets.length === 0 && (
                                  <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                                    <User size={12} className="text-muted-foreground/30" />
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-foreground truncate">{folder.name}</div>
                              <div className="text-[9px] text-muted-foreground/50">{folder.assets.length} assets</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Props */}
                  {propFolders.length > 0 && (
                    <div className="mb-4">
                      <button
                        onClick={() => setExpandedFolderSections(s => ({ ...s, prop: !s.prop }))}
                        className="flex items-center gap-2 w-full text-left px-2 mb-2"
                      >
                        {expandedFolderSections.prop ? <CaretDown size={10} /> : <CaretRight size={10} />}
                        <Package size={12} className="text-accent" />
                        <span className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Props</span>
                        <span className="text-[10px] text-muted-foreground/40 ml-auto">{propFolders.length}</span>
                      </button>
                      {expandedFolderSections.prop && (
                        <div className="grid grid-cols-3 gap-2 pl-2">
                          {propFolders.map(folder => (
                            <button
                              key={folder.id}
                              onClick={() => setEditingFolder(folder)}
                              className="text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                            >
                              <div className="flex gap-1 mb-1.5">
                                {folder.assets.slice(0, 2).map((asset, i) => (
                                  <div key={i} className="w-8 h-8 rounded bg-white/5 overflow-hidden">
                                    <img src={asset.r2_url} alt="" className="w-full h-full object-cover" />
                                  </div>
                                ))}
                                {folder.assets.length === 0 && (
                                  <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                                    <Package size={12} className="text-muted-foreground/30" />
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-foreground truncate">{folder.name}</div>
                              <div className="text-[9px] text-muted-foreground/50">{folder.assets.length} assets</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Locations */}
                  {locationFolders.length > 0 && (
                    <div className="mb-4">
                      <button
                        onClick={() => setExpandedFolderSections(s => ({ ...s, location: !s.location }))}
                        className="flex items-center gap-2 w-full text-left px-2 mb-2"
                      >
                        {expandedFolderSections.location ? <CaretDown size={10} /> : <CaretRight size={10} />}
                        <MapPin size={12} className="text-accent" />
                        <span className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Locations</span>
                        <span className="text-[10px] text-muted-foreground/40 ml-auto">{locationFolders.length}</span>
                      </button>
                      {expandedFolderSections.location && (
                        <div className="grid grid-cols-3 gap-2 pl-2">
                          {locationFolders.map(folder => (
                            <button
                              key={folder.id}
                              onClick={() => setEditingFolder(folder)}
                              className="text-left p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                            >
                              <div className="flex gap-1 mb-1.5">
                                {folder.assets.slice(0, 2).map((asset, i) => (
                                  <div key={i} className="w-8 h-8 rounded bg-white/5 overflow-hidden">
                                    <img src={asset.r2_url} alt="" className="w-full h-full object-cover" />
                                  </div>
                                ))}
                                {folder.assets.length === 0 && (
                                  <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                                    <MapPin size={12} className="text-muted-foreground/30" />
                                  </div>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-foreground truncate">{folder.name}</div>
                              <div className="text-[9px] text-muted-foreground/50">{folder.assets.length} assets</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Assets grid */}
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <span className="text-xs font-mono text-muted-foreground/50">Loading...</span>
                </div>
              ) : Object.keys(groupedGenAssets).length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <ClockCounterClockwise size={24} className="text-muted-foreground/30" />
                  <span className="text-xs font-mono text-muted-foreground/50">No generations yet</span>
                </div>
              ) : (
                Object.entries(groupedGenAssets).map(([monthYear, monthAssets]) => (
                  <div key={monthYear} className="mb-4">
                    <h3 className="text-xs text-muted-foreground/50 uppercase tracking-wider px-2 mb-2">
                      {monthYear}
                    </h3>
                    <div className="grid grid-cols-6 gap-2">
                      {monthAssets.map(asset => {
                        const isSel = selectedAssetIds.has(asset.id)
                        return (
                          <button
                            key={asset.id}
                            onClick={() => {
                              if (selectMode) toggleAssetSelected(asset.id)
                              else setSelectedGenAsset(asset)
                            }}
                            className={`relative aspect-square rounded-lg overflow-hidden bg-card border transition-colors group ${
                              isSel
                                ? 'border-accent ring-2 ring-accent/60'
                                : 'border-border/30 hover:border-accent/50'
                            }`}
                          >
                            {asset.type === 'video' ? (
                              <video src={asset.r2_url} className="w-full h-full object-cover" muted preload="metadata" />
                            ) : (
                              <img src={asset.r2_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            )}
                            <div className="absolute top-1 left-1 flex gap-0.5">
                              {asset.type === 'video' && (
                                <div className="w-4 h-4 rounded bg-black/60 flex items-center justify-center">
                                  <VideoCamera size={10} className="text-white" />
                                </div>
                              )}
                              {asset.used_in_canvas && (
                                <div className="w-4 h-4 rounded bg-accent/80 flex items-center justify-center">
                                  <ShieldCheck size={10} className="text-white" />
                                </div>
                              )}
                            </div>
                            {selectMode && (
                              <div className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${
                                isSel
                                  ? 'bg-accent border-accent text-white'
                                  : 'bg-black/60 border-white/30 text-transparent'
                              }`}>
                                <Check size={11} weight="bold" />
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            // Detail view
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <button
                onClick={() => setSelectedGenAsset(null)}
                className="text-xs font-mono text-accent mb-3 hover:underline"
              >
                ← Back
              </button>

              <div className="rounded-lg overflow-hidden bg-card border border-border/30 mb-3 aspect-video">
                {selectedGenAsset.type === 'video' ? (
                  <video src={selectedGenAsset.r2_url} controls className="w-full h-full object-cover" />
                ) : (
                  <img src={selectedGenAsset.r2_url} alt="" className="w-full h-full object-cover" />
                )}
              </div>

              <div className="space-y-2 mb-4 text-xs font-mono">
                <div className="flex justify-between text-muted-foreground/60">
                  <span>Type</span>
                  <span className="text-foreground capitalize">{selectedGenAsset.type}</span>
                </div>
                <div className="flex justify-between text-muted-foreground/60">
                  <span>Date Created</span>
                  <span className="text-foreground">{formatDate(selectedGenAsset.created_at)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground/60">
                  <span>AI Model</span>
                  <span className="text-foreground truncate ml-2">{selectedGenAsset.model.split('/').pop()}</span>
                </div>
                <div className="flex justify-between text-muted-foreground/60">
                  <span>Status</span>
                    <span className={selectedGenAsset.used_in_canvas ? 'text-accent' : 'text-muted-foreground'}>
                      {selectedGenAsset.used_in_canvas ? 'Protected' : 'Temporary'}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground/60 uppercase">Prompt</span>
                  <button
                    onClick={() => copyPrompt(selectedGenAsset.prompt)}
                    className="flex items-center gap-1 text-xs font-mono text-accent hover:underline"
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <p className="text-xs font-mono text-foreground/80 bg-card/50 rounded p-2 border border-border/30 leading-relaxed">
                  {selectedGenAsset.prompt}
                </p>
              </div>

              <div className="flex gap-2">
                <a
                  href={selectedGenAsset.r2_url}
                  download
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent text-background text-xs font-mono hover:bg-accent/90 transition-colors"
                >
                  <Download size={12} /> Download
                </a>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs font-mono hover:bg-red-500/30 transition-colors"
                    >
                      <Trash size={12} />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#0D0F12] border-white/10">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Permanently delete asset?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this asset from storage. This action cannot be undone. Assets removed from the canvas can still be found here, but this deletion is final.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30"
                        onClick={async () => {
                          const currentIndex = filteredGenAssets.findIndex(a => a.id === selectedGenAsset.id)
                          const nextAsset = filteredGenAssets[currentIndex + 1] ?? filteredGenAssets[currentIndex - 1] ?? null

                          await fetch(`/api/assets/${selectedGenAsset.id}`, {
                            method: 'DELETE'
                          })

                          mutateAssets()
                          setSelectedGenAsset(nextAsset ?? null)
                          toast.success('Asset deleted from storage')
                        }}
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>

        {/* Bulk-delete confirmation (shared between compact + expanded views;
            Radix portals it so location in the tree doesn't matter). */}
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent className="bg-[#0D0F12] border-white/10">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selectedAssetIds.size} asset{selectedAssetIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes them from storage and the asset library. Any selected assets currently used on a canvas are skipped — clear them off the canvas first if you want them gone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10" disabled={bulkDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30"
                disabled={bulkDeleting}
                onClick={performBulkDelete}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selectedAssetIds.size}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk action bar — only visible in select mode */}
        {selectMode && (
          <div className="px-3 py-2 border-t border-border/30 flex items-center justify-between bg-accent/5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-foreground/90">
                {selectedAssetIds.size} selected
              </span>
              <button
                onClick={selectAllVisible}
                className="text-[11px] text-accent hover:underline"
              >
                Select all
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setBulkDeleteOpen(true)}
                disabled={selectedAssetIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash size={10} />
                Delete
              </button>
              <button
                onClick={exitSelectMode}
                className="px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border/30 flex justify-between text-xs text-muted-foreground/50">
          <span>{filteredGenAssets.length} items</span>
            <span>{filteredGenAssets.filter(a => a.is_upload).length} uploads</span>
        </div>
      </div>
    )
  }

  // COMPACT TOOLBAR (normal view when history is closed)
  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-start gap-2">
      <div className="flex flex-col gap-1 glass rounded-xl p-1.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              setLocalActiveTool(tool.id)
              if (tool.id === 'add' && onAddNode) onAddNode('imageGen')
              if (tool.id === 'cut' && onSetTool) onSetTool('cut')
              if (tool.id === 'select' && onSetTool) onSetTool('select')
              if (tool.id === 'sticker' && onSetTool) onSetTool('sticker')
              if (tool.id === 'comment' && onSetTool) onSetTool('comment')
            }}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
              activeTool === tool.id
                ? 'bg-white/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
            title={tool.label}
          >
            <tool.icon size={14} weight={activeTool === tool.id ? 'fill' : 'thin'} />
          </button>
        ))}

        <div className="h-px bg-border my-1" />

        <button
          onClick={handleToggleHistory}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-muted-foreground hover:text-foreground hover:bg-white/5"
            title="Assets"
        >
          <ClockCounterClockwise size={14} weight="thin" />
        </button>

        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              setExpanded(true)
              setExpandedCategory(cat.id)
            }}
            className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
              expanded && expandedCategory === cat.id
                ? 'bg-white/10 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
            }`}
            title={cat.label}
          >
            <cat.icon size={14} weight="thin" />
          </button>
        ))}

        <div className="h-px bg-border my-1" />

        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
            canUndo 
              ? 'text-muted-foreground hover:text-foreground hover:bg-white/5' 
              : 'text-muted-foreground/30 cursor-not-allowed'
          }`}
          title="Undo"
        >
          <ArrowCounterClockwise size={14} weight="thin" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
            canRedo 
              ? 'text-muted-foreground hover:text-foreground hover:bg-white/5' 
              : 'text-muted-foreground/30 cursor-not-allowed'
          }`}
          title="Redo"
        >
          <ArrowClockwise size={14} weight="thin" />
        </button>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          title="Settings"
        >
          <Gear size={14} weight="thin" />
        </button>
      </div>

      {/* Expanded asset category panel */}
      {expanded && !historyOpen && (
        <div className="glass rounded-xl w-72 max-h-[70vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-[11px] font-mono font-medium text-foreground">
              {ASSET_CATEGORIES.find(c => c.id === expandedCategory)?.label || 'Assets'}
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground"
            >
              <X size={10} />
            </button>
          </div>

          <div className="flex gap-0.5 px-2 py-1.5 border-b border-border/30">
            {ASSET_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setExpandedCategory(cat.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] font-mono transition-colors ${
                  expandedCategory === cat.id
                    ? 'bg-accent/20 text-accent'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <cat.icon size={10} weight="thin" />
              </button>
            ))}
          </div>

          <div className="px-2 py-1.5">
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-input border border-border/50">
              <MagnifyingGlass size={10} className="text-muted-foreground/60" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                  <X size={8} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-1">
            {expandedCategory && (() => {
              // Map category to folder type
              const folderType = expandedCategory === 'characters' ? 'character' 
                : expandedCategory === 'props' ? 'prop'
                : expandedCategory === 'locations' ? 'location'
                : 'general'
              const categoryFolders = folders.filter(f => f.type === folderType)
              const cat = ASSET_CATEGORIES.find(c => c.id === expandedCategory)!
              
              if (categoryFolders.length === 0) {
                return (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <div className="w-10 h-10 rounded-lg bg-card/50 border border-dashed border-border/50 flex items-center justify-center">
                      <cat.icon size={16} className="text-muted-foreground/40" />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground/50">
                      No {cat.label.toLowerCase()} yet
                    </span>
                    <span className="text-[9px] text-muted-foreground/30">
                      Add via node context menu
                    </span>
                  </div>
                )
              }

              return (
                <div className="space-y-1">
                  {categoryFolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setEditingFolder(folder)}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors group text-left"
                    >
                      <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-card border border-border/30">
                        {folder.assets[0] ? (
                          <img src={folder.assets[0].r2_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <cat.icon size={14} className="text-muted-foreground/30" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono text-foreground/80 truncate">{folder.name}</div>
                        <div className="text-[9px] text-muted-foreground/50">
                          {folder.assets.length} asset{folder.assets.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>

          {expandedCategory && (
            <div className="px-2 py-2 border-t border-border/30">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-[10px] font-mono transition-colors disabled:opacity-50"
              >
                <UploadSimple size={10} weight={uploading ? 'fill' : 'bold'} />
                {uploading ? 'Uploading...' : 'Upload Asset'}
              </button>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Edit folder modal */}
      {editingFolder && (
        <AddToFolderModal
          open={!!editingFolder}
          onClose={() => { setEditingFolder(null); mutateFolders() }}
          folderType={editingFolder.type}
          projectId={projectId}
          assetId=""
          assetUrl=""
          editFolder={editingFolder}
        />
      )}
    </div>
  )
}
