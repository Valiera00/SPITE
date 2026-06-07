'use client'

import { Position, NodeProps, Handle, useReactFlow } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { Image as ImageIcon, UploadSimple, CircleNotch, VideoCamera } from '@phosphor-icons/react'
import { memo, useState, useEffect, useRef } from 'react'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { AddToFolderModal } from '../add-to-folder-modal'
import { Lightbox } from '../lightbox'

function ReferenceNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const { setNodes } = useReactFlow()
  const [imageWidth, setImageWidth] = useState<number>((data.width as number) || 320)
  const [thumbnail, setThumbnail] = useState<string | null>((data.thumbnail as string) || null)
  const widthRef = useRef(imageWidth)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderType, setFolderType] = useState<'character' | 'prop' | 'location'>('character')
  const [lightboxOpen, setLightboxOpen] = useState(false)

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
  const isVideo = (data.mediaType as string) === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(thumbnail || '')

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
        nodeLabel={(data.label as string) || 'Reference'}
        assetId={data.assetId as string}
        assetUrl={thumbnail || undefined}
        assetType={isVideo ? 'video' : 'image'}
        onAddToFolder={handleAddToFolder}
        onViewFullscreen={thumbnail ? () => setLightboxOpen(true) : undefined}
      />

      <Lightbox
        open={lightboxOpen}
        url={thumbnail}
        type={isVideo ? 'video' : 'image'}
        onClose={() => setLightboxOpen(false)}
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
      <Handle type="target" position={Position.Left} style={{ opacity: 0, zIndex: 5 }} />
      <Handle
        type="source"
        id={isVideo ? 'video-out' : 'image-out'}
        position={Position.Right}
        style={{ top: '50%', right: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }}
      />
      {/* Visible output indicator so the reference can be wired into a generator */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#111316',
          border: `1.5px solid ${isVideo ? 'rgba(244,114,182,0.85)' : 'rgba(96,165,250,0.85)'}`,
          top: '50%',
          right: -12,
          transform: 'translateY(-50%)',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {isVideo
          ? <VideoCamera size={11} weight="bold" style={{ color: 'rgba(244,114,182,0.95)' }} />
          : <ImageIcon size={11} weight="bold" style={{ color: 'rgba(96,165,250,0.95)' }} />}
      </div>

      {/* Card */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          width: imageWidth,
          background: '#0D0F12',
          border: isTaggedToShot 
            ? '1.5px solid rgba(251,191,36,0.7)' 
            : selected 
              ? '1.5px solid rgba(107,143,168,0.85)' 
              : '1.5px solid rgba(107,143,168,0.25)',
        }}
      >
        {/* Image area */}
        {thumbnail ? (
          <div
            className="relative"
            onDoubleClick={() => { if (thumbnail && !isUploading) setLightboxOpen(true) }}
          >
            {isVideo ? (
              <video
                src={thumbnail}
                className="w-full h-auto block cursor-zoom-in"
                muted
                loop
                controls
                playsInline
                preload="metadata"
                controlsList="nofullscreen"
                onDoubleClick={(e) => {
                  // Suppress the browser's native fullscreen on the video controls.
                  e.preventDefault()
                  e.stopPropagation()
                  if (!isUploading) setLightboxOpen(true)
                }}
              />
            ) : (
              <img src={thumbnail} alt="" className="w-full h-auto block cursor-zoom-in" loading="lazy" decoding="async" />
            )}
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <CircleNotch size={24} className="text-white animate-spin" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground/40">
            <ImageIcon size={28} />
            <span className="text-xs">Drop image or video</span>
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
        projectId={projectId}
        assetId={(data.assetId as string) || ''}
        assetUrl={thumbnail || ''}
      />
    </div>
  )
}

export const ReferenceNode = memo(ReferenceNodeImpl)
ReferenceNode.displayName = 'ReferenceNode'
