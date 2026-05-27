'use client'

import { Position, NodeProps, Handle, useReactFlow } from '@xyflow/react'
import { Image as ImageIcon, UploadSimple, CircleNotch } from '@phosphor-icons/react'
import { useState, useEffect, useRef } from 'react'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { AddToFolderModal } from '../add-to-folder-modal'

export function ReferenceNode({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow()
  const [imageWidth, setImageWidth] = useState<number>((data.width as number) || 320)
  const [thumbnail, setThumbnail] = useState<string | null>((data.thumbnail as string) || null)
  const widthRef = useRef(imageWidth)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderType, setFolderType] = useState<'character' | 'prop' | 'location'>('character')

  // Keep ref in sync
  useEffect(() => {
    widthRef.current = imageWidth
  }, [imageWidth])

  // Sync thumbnail from data prop
  useEffect(() => {
    if (data.thumbnail && data.thumbnail !== thumbnail) {
      setThumbnail(data.thumbnail as string)
    }
  }, [data.thumbnail, thumbnail])

  const shots: ShotOption[] = (data.availableShots as ShotOption[]) || [
    { id: 'shot-1', label: 'Select shot' },
  ]
  const selectedShotId = (data.selectedShotId as string) || undefined
  const isTaggedToShot = !!selectedShotId
  const isUploading = data.isUploading as boolean

  const handleShotSelect = (shotId: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, selectedShotId: shotId } } : n))
  }

  const handleNewShot = () => {}

  const handleAddToFolder = (type: 'character' | 'prop' | 'location') => {
    setFolderType(type)
    setFolderModalOpen(true)
  }

  // Resize: drag horizontally to change width
  const onResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    
    const startX = e.clientX
    const startWidth = widthRef.current
    let lastUpdateTime = Date.now()
    
    const onMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startX
      const newWidth = Math.max(150, Math.min(800, startWidth + diff))
      
      // Update ref immediately so onUp has correct final width
      widthRef.current = newWidth
      
      // Throttle state updates to avoid ResizeObserver spam - update max every 50ms
      const now = Date.now()
      if (now - lastUpdateTime > 50) {
        setImageWidth(newWidth)
        lastUpdateTime = now
      }
    }
    
    const onUp = () => {
      // Use the ref value which was updated on every mousemove
      const finalWidth = widthRef.current
      setImageWidth(finalWidth)
      setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, width: finalWidth } } : n))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="relative group">
      <NodeActionToolbar 
        nodeId={id} 
        selected={selected} 
        assetId={data.assetId as string}
        assetUrl={thumbnail || undefined}
        onAddToFolder={handleAddToFolder}
      />

      {/* Header above card */}
      <div className="absolute -top-8 left-0 flex items-center gap-2 z-10">
        <ShotSelector
          selectedShotId={selectedShotId}
          shots={shots}
          onSelect={handleShotSelect}
          onNewShot={handleNewShot}
        />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[200px]">
          {(data.label as string) || 'Reference'}
        </span>
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" id="image-out" position={Position.Right} style={{ top: '50%', opacity: 0 }} />

      {/* Card */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          width: imageWidth,
          background: '#0D0F12',
          border: isTaggedToShot 
            ? '1.5px solid rgba(251,191,36,0.7)' 
            : selected 
              ? '1.5px solid rgba(168,85,247,0.85)' 
              : '1.5px solid rgba(168,85,247,0.25)',
        }}
      >
        {/* Image area */}
        {thumbnail ? (
          <div className="relative">
            <img src={thumbnail} alt="" className="w-full h-auto block" />
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <CircleNotch size={24} className="text-white animate-spin" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground/40">
            <ImageIcon size={28} />
            <span className="text-xs">Drop image</span>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {(data.label as string) || 'reference'}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">REF</span>
        </div>
      </div>

      {/* Resize handle - quarter circle arc hugging the corner */}
      <div
        className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity cursor-se-resize"
        style={{ bottom: -10, right: -10 }}
        onMouseDown={(e) => {
          onResizeStart(e)
        }}
      >
        <svg width="28" height="28" viewBox="0 0 28 28">
          <path
            d="M 0 28 A 28 28 0 0 0 28 0"
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="2"
          />
        </svg>
      </div>

      {/* Add to folder modal */}
      <AddToFolderModal
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        folderType={folderType}
        assetId={(data.assetId as string) || ''}
        assetUrl={thumbnail || ''}
      />
    </div>
  )
}

ReferenceNode.displayName = 'ReferenceNode'
