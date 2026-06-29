'use client'

import { useState, useRef } from 'react'
import { Plus, CaretDown, Play, CaretLeft, CaretRight, Image as ImageIcon, DownloadSimple, CircleNotch, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { exportScenesAsZip } from '@/lib/export-scenes'

export interface Shot {
  id: string
  nodeId: string  // Links to actual node on canvas
  thumbnail?: string
  // The actual file URL to download on export (image file for image shots,
  // video file for video shots). Different from `thumbnail` for videos —
  // `thumbnail` is the poster image, `mediaUrl` is the .mp4.
  mediaUrl?: string
  label?: string
  hasVideo?: boolean
  order: number
}

export interface Scene {
  id: string
  name: string
  shots: Shot[]
}

interface SceneTimelineProps {
  scenes: Scene[]
  activeSceneId: string
  onSceneChange: (sceneId: string) => void
  onAddScene: () => void
  onDeleteScene?: (sceneId: string) => void
  onShotClick?: (sceneId: string, shotId: string) => void
  onReorderShot?: (sceneId: string, shotId: string, newIndex: number) => void
  // Optional project name used as the downloaded zip's filename.
  projectName?: string
}

export function SceneTimeline({
  scenes,
  activeSceneId,
  onSceneChange,
  onAddScene,
  onDeleteScene,
  onShotClick,
  onReorderShot,
  projectName,
}: SceneTimelineProps) {
  const [exporting, setExporting] = useState(false)
  // Confirmation modal for scene deletion. Null = no modal. Stores
  // the scene id + name so the message can name the scene the user
  // is about to delete.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; shotCount: number } | null>(null)

  // Down the line we could open a small dialog asking "one zip vs zip
  // per scene" / "rename to Shot1.. or keep labels" — for now the chosen
  // convention is: one zip, one folder per scene, files named
  // "Shot <order>.<ext>" preserving the original numbering (placeholders
  // produce gaps, not renumbering). User asked for these defaults.
  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    const toastId = toast.loading('Building zip...')
    try {
      const result = await exportScenesAsZip(
        scenes,
        projectName || 'frame-export',
      )
      const skippedCount = result.skipped.length
      toast.success(
        skippedCount > 0
          ? `Exported ${result.fileCount} shot${result.fileCount === 1 ? '' : 's'} (${skippedCount} skipped)`
          : `Exported ${result.fileCount} shot${result.fileCount === 1 ? '' : 's'}`,
        { id: toastId },
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed', { id: toastId })
    } finally {
      setExporting(false)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const [draggedShot, setDraggedShot] = useState<{ sceneId: string; shotId: string; index: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ sceneId: string; index: number } | null>(null)
  // Scene tiles can be independently collapsed to just their first shot.
  // The whole bar always stays visible — toggle is per-scene.
  const [collapsedScenes, setCollapsedScenes] = useState<Set<string>>(new Set())
  const toggleCollapsed = (sceneId: string) => {
    setCollapsedScenes((prev) => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })
  }

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -240, behavior: 'smooth' })
  }

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 240, behavior: 'smooth' })
  }

  const handleDragStart = (sceneId: string, shotId: string, index: number) => {
    setDraggedShot({ sceneId, shotId, index })
  }

  const handleDragOver = (e: React.DragEvent, sceneId: string, index: number) => {
    e.preventDefault()
    if (draggedShot && draggedShot.sceneId === sceneId) {
      setDropTarget({ sceneId, index })
    }
  }

  const handleDrop = (e: React.DragEvent, sceneId: string, index: number) => {
    e.preventDefault()
    if (draggedShot && draggedShot.sceneId === sceneId && onReorderShot) {
      onReorderShot(sceneId, draggedShot.shotId, index)
    }
    setDraggedShot(null)
    setDropTarget(null)
  }

  const handleDragEnd = () => {
    setDraggedShot(null)
    setDropTarget(null)
  }

  return (
    <div data-tour="scene-timeline" className="flex flex-col shrink-0 border-b border-border/50 bg-[#0a0c0e]">
      {/* Scene tabs row with scroll controls */}
      <div className="relative flex items-center">
        {/* Scroll left button */}
        <button
          onClick={scrollLeft}
          className="shrink-0 w-8 h-full flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Scroll left"
        >
          <CaretLeft size={16} weight="bold" />
        </button>

        {/* Scrollable scene tabs — ~20% taller than before (h-20 → h-24).
            Scrollbar is now visible + dark-themed (see globals.css) so the
            user can drag the thumb instead of relying on the +/- arrows.
            Without the hidden class the default browser scrollbar showed
            up as bright white against the near-black canvas. */}
        <div
          ref={scrollRef}
          className="flex-1 flex items-stretch h-24 overflow-x-auto gap-1.5 px-1 py-2"
        >
          {scenes.map((scene) => {
            const isActive = scene.id === activeSceneId
            const sortedShots = [...scene.shots].sort((a, b) => a.order - b.order)
            const isCollapsed = collapsedScenes.has(scene.id)
            const realShots = sortedShots.filter((s) => s.nodeId)
            // In collapsed mode show just the first real shot (or the first
            // slot if there are no real shots yet) so the scene still gets
            // a visual anchor instead of an empty rectangle.
            const visibleShots = isCollapsed
              ? sortedShots.slice(0, 1)
              : sortedShots

            return (
              <div
                key={scene.id}
                onClick={() => onSceneChange(scene.id)}
                // shrink-0 is the critical bit — without it, flex would
                // shrink tiles below their min-width when many scenes
                // are added (the symptom was 17 squished tiles instead
                // of a scrollable strip). Collapsed tiles get a slightly
                // larger min so even the compact form stays readable.
                className={`
                  group/scene relative flex items-center gap-2.5 px-4 shrink-0 ${isCollapsed ? 'min-w-[160px]' : 'min-w-[220px]'} rounded-lg cursor-pointer transition-all
                  ${isActive
                    ? 'bg-accent/10 border border-accent/40'
                    : 'bg-card/30 border border-border/30 hover:bg-card/50 hover:border-border/50'}
                `}
              >
                {/* Scene label */}
                <div className="flex flex-col gap-0.5 shrink-0 min-w-[68px]">
                  <div className="flex items-center gap-1">
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    <span className={`text-[13px] font-mono ${isActive ? 'text-foreground' : 'text-muted-foreground/80'}`}>
                      {scene.name}
                    </span>
                    <CaretDown size={10} className="text-muted-foreground/40" />
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground/40 pl-2.5">
                    {realShots.length} {realShots.length === 1 ? 'shot' : 'shots'}
                  </span>
                </div>

                {/* Shot thumbnails filmstrip — scrolls horizontally when
                    expanded and there are too many shots to fit. */}
                <div className={`flex items-center gap-1.5 flex-1 py-1 ${isCollapsed ? 'overflow-hidden' : 'overflow-x-auto scrollbar-hide'}`}>
                  {visibleShots.map((shot, index) => (
                    <div
                      key={shot.id}
                      draggable={!isCollapsed && !!shot.nodeId}
                      onDragStart={() => shot.nodeId && handleDragStart(scene.id, shot.id, index)}
                      onDragOver={(e) => handleDragOver(e, scene.id, index)}
                      onDrop={(e) => handleDrop(e, scene.id, index)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (shot.nodeId) onShotClick?.(scene.id, shot.id)
                      }}
                      className={`
                        relative shrink-0 w-[58px] h-[44px] rounded overflow-hidden transition-all duration-150
                        ${shot.nodeId && !isCollapsed ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                        ${!shot.nodeId ? 'border border-dashed border-border/50 bg-card/20' : shot.thumbnail ? '' : 'bg-card border border-border/50'}
                        ${dropTarget?.sceneId === scene.id && dropTarget.index === index ? 'ring-2 ring-accent scale-105' : ''}
                      `}
                    >
                      {shot.thumbnail ? (
                        <img
                          src={shot.thumbnail}
                          alt={shot.label || `Shot ${shot.order}`}
                          className="w-full h-full object-cover"
                          draggable={false}
                        />
                      ) : !shot.nodeId ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-muted-foreground/40">
                          <ImageIcon size={14} />
                          <span className="text-[9px] font-mono leading-none">{shot.order}</span>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-muted-foreground/40">
                          {shot.order}
                        </div>
                      )}
                      {/* Shot number badge for real shots with thumbnails */}
                      {shot.thumbnail && shot.nodeId && (
                        <div className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white/80">
                          {shot.order}
                        </div>
                      )}
                      {/* Video indicator */}
                      {shot.hasVideo && (
                        <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-accent/90 flex items-center justify-center">
                          <Play size={7} weight="fill" className="text-white" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* When collapsed and there's more than one shot, show
                      a small "+N" pill so the user knows there's more
                      hidden in this scene. */}
                  {isCollapsed && sortedShots.length > 1 && (
                    <div className="shrink-0 px-1.5 h-[44px] flex items-center text-[10px] font-mono text-muted-foreground/60">
                      +{sortedShots.length - 1}
                    </div>
                  )}

                  {/* Empty state when no shots tagged at all */}
                  {realShots.length === 0 && !isCollapsed && (
                    <div className="w-[58px] h-[44px] rounded border border-dashed border-border/40 flex items-center justify-center">
                      <span className="text-[10px] font-mono text-muted-foreground/30">Empty</span>
                    </div>
                  )}
                </div>

                {/* Collapse / expand toggle (per scene). Arrow points
                    LEFT when expanded ("pull the filmstrip closed") and
                    RIGHT when collapsed ("open it up"). Click stops
                    propagation so it doesn't also change the active scene. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapsed(scene.id)
                  }}
                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground/50 hover:text-foreground transition-colors"
                  aria-label={isCollapsed ? 'Expand scene' : 'Collapse scene'}
                  title={isCollapsed ? 'Expand scene' : 'Collapse scene'}
                >
                  {isCollapsed ? <CaretRight size={14} weight="bold" /> : <CaretLeft size={14} weight="bold" />}
                </button>

                {/* Add shot button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // This would trigger adding the selected node to this scene
                  }}
                  className="shrink-0 w-7 h-7 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  aria-label="Add shot"
                >
                  <Plus size={14} weight="bold" />
                </button>

                {/* Delete scene — only revealed on hover so the bar
                    stays calm, and only when the parent provided an
                    onDeleteScene handler. Also hidden when there's
                    only one scene left (can't delete the last one
                    without leaving the user with nothing to switch
                    back to). Clicking opens a confirmation modal
                    rather than nuking immediately. */}
                {onDeleteScene && scenes.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete({
                        id: scene.id,
                        name: scene.name,
                        shotCount: realShots.length,
                      })
                    }}
                    className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-muted-foreground/30 hover:bg-red-500/15 hover:text-red-400 opacity-0 group-hover/scene:opacity-100 transition-all"
                    aria-label={`Delete ${scene.name}`}
                    title={`Delete ${scene.name}`}
                  >
                    <Trash size={13} weight="bold" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Add scene button */}
          <button
            onClick={onAddScene}
            className="flex items-center justify-center px-7 min-w-[88px] rounded-lg border border-dashed border-border/40 hover:border-accent/30 hover:bg-accent/5 text-muted-foreground/40 hover:text-accent transition-all"
            aria-label="Add scene"
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>

        {/* Scroll right button */}
        <button
          onClick={scrollRight}
          className="shrink-0 w-8 h-full flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Scroll right"
        >
          <CaretRight size={16} weight="bold" />
        </button>
      </div>

      {/* Progress bar indicator */}
      <div className="h-0.5 bg-border/20 mx-2">
        <div
          className="h-full bg-accent/40 transition-all"
          style={{
            width: `${((scenes.findIndex(s => s.id === activeSceneId) + 1) / scenes.length) * 100}%`
          }}
        />
      </div>

      {/* Active scene indicator + actions */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/5 transition-colors">
          <div className="w-2 h-2 rounded-full bg-accent/60" />
          <span className="text-[13px] font-mono text-foreground/80">
            {scenes.find(s => s.id === activeSceneId)?.name || 'Scene 1'}
          </span>
          <CaretDown size={12} className="text-muted-foreground/60" />
        </button>

        <div className="ml-auto">
          <button
            data-tour="export"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-mono text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-wait"
            title="Download every tagged shot across all scenes as a zip"
          >
            {exporting ? (
              <CircleNotch size={13} weight="bold" className="animate-spin" />
            ) : (
              <DownloadSimple size={13} weight="bold" />
            )}
            <span>{exporting ? 'Exporting...' : 'Export shots'}</span>
          </button>
        </div>
      </div>

      {/* Delete-scene confirmation modal. Backdrop closes (treats as
          cancel), escape key closes via the backdrop's onClick. The
          parent owns the actual deletion via onDeleteScene; we just
          gate it on a user confirmation. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-[420px] max-w-[90vw] rounded-xl border border-border/40 bg-[#0a0c0e] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-medium text-foreground mb-2">
              Delete {pendingDelete.name}?
            </h3>
            <p className="text-[13px] text-muted-foreground leading-relaxed mb-5">
              {pendingDelete.shotCount > 0
                ? `This scene has ${pendingDelete.shotCount} tagged shot${pendingDelete.shotCount === 1 ? '' : 's'}. Every node on its canvas will be deleted along with it.`
                : 'All nodes on this scene’s canvas will be deleted.'}
              {' '}This can’t be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeleteScene?.(pendingDelete.id)
                  setPendingDelete(null)
                }}
                className="px-3 py-1.5 rounded text-[13px] bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              >
                Delete scene
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
