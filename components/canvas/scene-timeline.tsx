'use client'

import { useState, useRef } from 'react'
import { Plus, CaretDown, Play, CaretLeft, CaretRight, Check } from '@phosphor-icons/react'

export interface Shot {
  id: string
  nodeId: string  // Links to actual node on canvas
  thumbnail?: string
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
  onShotClick?: (sceneId: string, shotId: string) => void
  onReorderShot?: (sceneId: string, shotId: string, newIndex: number) => void
}

export function SceneTimeline({
  scenes,
  activeSceneId,
  onSceneChange,
  onAddScene,
  onShotClick,
  onReorderShot,
}: SceneTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [draggedShot, setDraggedShot] = useState<{ sceneId: string; shotId: string; index: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ sceneId: string; index: number } | null>(null)

  const scrollLeft = () => {
    scrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })
  }

  const scrollRight = () => {
    scrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })
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
    <div className="flex flex-col shrink-0 border-b border-border/50 bg-[#0a0c0e]">
      {/* Scene tabs row with scroll controls */}
      <div className="relative flex items-center">
        {/* Scroll left button */}
        <button
          onClick={scrollLeft}
          className="shrink-0 w-6 h-full flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <CaretLeft size={12} weight="bold" />
        </button>

        {/* Scrollable scene tabs */}
        <div
          ref={scrollRef}
          className="flex-1 flex items-stretch h-20 overflow-x-auto gap-1 px-1 py-2 scrollbar-hide"
        >
          {scenes.map((scene) => {
            const isActive = scene.id === activeSceneId
            const sortedShots = [...scene.shots].sort((a, b) => a.order - b.order)

            return (
              <div
                key={scene.id}
                onClick={() => onSceneChange(scene.id)}
                className={`
                  relative flex items-center gap-2 px-3 min-w-[160px] rounded-lg cursor-pointer transition-all
                  ${isActive 
                    ? 'bg-accent/10 border border-accent/40' 
                    : 'bg-card/30 border border-border/30 hover:bg-card/50 hover:border-border/50'}
                `}
              >
                {/* Scene label */}
                <div className="flex flex-col gap-0.5 shrink-0 min-w-[60px]">
                  <div className="flex items-center gap-1">
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    <span className={`text-[11px] font-mono ${isActive ? 'text-foreground' : 'text-muted-foreground/80'}`}>
                      {scene.name}
                    </span>
                    <CaretDown size={8} className="text-muted-foreground/40" />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground/40 pl-2.5">
                    {sortedShots.filter(s => s.nodeId).length} {sortedShots.filter(s => s.nodeId).length === 1 ? 'shot' : 'shots'}
                  </span>
                </div>

                {/* Shot thumbnails filmstrip */}
                <div className="flex items-center gap-1 overflow-hidden flex-1 py-1">
                  {sortedShots.map((shot, index) => (
                    <div
                      key={shot.id}
                      draggable={!!shot.nodeId}
                      onDragStart={() => shot.nodeId && handleDragStart(scene.id, shot.id, index)}
                      onDragOver={(e) => handleDragOver(e, scene.id, index)}
                      onDrop={(e) => handleDrop(e, scene.id, index)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (shot.nodeId) onShotClick?.(scene.id, shot.id)
                      }}
                      className={`
                        relative shrink-0 w-12 h-9 rounded overflow-hidden transition-all duration-150
                        ${shot.nodeId ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-30'}
                        ${!shot.nodeId ? 'border border-dashed border-border/40 bg-transparent' : shot.thumbnail ? '' : 'bg-card border border-border/50'}
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
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] font-mono text-muted-foreground/40">
                          {shot.order}
                        </div>
                      )}
                      {/* Shot number badge for real shots with thumbnails */}
                      {shot.thumbnail && shot.nodeId && (
                        <div className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-black/60 text-[7px] font-mono text-white/80">
                          {shot.order}
                        </div>
                      )}
                      {/* Video indicator */}
                      {shot.hasVideo && (
                        <div className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-accent/90 flex items-center justify-center">
                          <Play size={6} weight="fill" className="text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {/* Empty state when no shots tagged at all */}
                  {sortedShots.filter(s => s.nodeId).length === 0 && (
                    <div className="w-12 h-9 rounded border border-dashed border-border/40 flex items-center justify-center">
                      <span className="text-[8px] font-mono text-muted-foreground/30">Empty</span>
                    </div>
                  )}
                </div>

                {/* Add shot button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // This would trigger adding the selected node to this scene
                  }}
                  className="shrink-0 w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  <Plus size={12} weight="bold" />
                </button>
              </div>
            )
          })}

          {/* Add scene button */}
          <button
            onClick={onAddScene}
            className="flex items-center justify-center px-6 min-w-[80px] rounded-lg border border-dashed border-border/40 hover:border-accent/30 hover:bg-accent/5 text-muted-foreground/40 hover:text-accent transition-all"
          >
            <Plus size={14} weight="bold" />
          </button>
        </div>

        {/* Scroll right button */}
        <button
          onClick={scrollRight}
          className="shrink-0 w-6 h-full flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <CaretRight size={12} weight="bold" />
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

      {/* Active scene indicator */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/5 transition-colors">
          <div className="w-2 h-2 rounded-full bg-accent/60" />
          <span className="text-[11px] font-mono text-foreground/80">
            {scenes.find(s => s.id === activeSceneId)?.name || 'Scene 1'}
          </span>
          <CaretDown size={10} className="text-muted-foreground/60" />
        </button>
      </div>
    </div>
  )
}
