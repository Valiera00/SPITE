'use client'

import { Position, NodeProps, Handle, useReactFlow } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { Image as ImageIcon, UploadSimple, CircleNotch, VideoCamera, SpeakerHigh } from '@phosphor-icons/react'
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
  const isAudio = (data.mediaType as string) === 'audio' || /\.(mp3|wav|m4a|ogg|aac|flac)(\?|$)/i.test(thumbnail || '')
  const isVideo = !isAudio && ((data.mediaType as string) === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(thumbnail || ''))

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
        assetType={isAudio ? 'image' : isVideo ? 'video' : 'image'}
        onAddToFolder={handleAddToFolder}
        onViewFullscreen={thumbnail && !isAudio ? () => setLightboxOpen(true) : undefined}
      />

      {!isAudio && (
        <Lightbox
          open={lightboxOpen}
          url={thumbnail}
          type={isVideo ? 'video' : 'image'}
          onClose={() => setLightboxOpen(false)}
        />
      )}

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
        id={isAudio ? 'audio-out' : isVideo ? 'video-out' : 'image-out'}
        position={Position.Right}
        style={{ top: '50%', right: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }}
      />
      {/* Visible output indicator so the reference can be wired into a generator.
          Color by media type: blue=image, pink=video, amber=audio. */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#111316',
          border: `1.5px solid ${
            isAudio ? 'rgba(251,191,36,0.85)' :
            isVideo ? 'rgba(244,114,182,0.85)' :
            'rgba(96,165,250,0.85)'
          }`,
          top: '50%',
          right: -12,
          transform: 'translateY(-50%)',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {isAudio
          ? <SpeakerHigh size={11} weight="bold" style={{ color: 'rgba(251,191,36,0.95)' }} />
          : isVideo
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
        {/* Media area */}
        {thumbnail ? (
          <div
            className="relative"
            onDoubleClick={() => { if (thumbnail && !isUploading && !isAudio) setLightboxOpen(true) }}
          >
            {isAudio ? (
              <AudioPreview url={thumbnail} label={(data.label as string) || 'audio'} />
            ) : isVideo ? (
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
            <span className="text-xs">Drop image, video, or audio</span>
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

// Audio preview: extracts waveform peaks client-side via the Web Audio
// API and renders them as amber bars. Native <audio> controls below for
// scrub/play/volume. Bars brighten while playing so the user can see at
// a glance which audio node is active on the canvas.
function AudioPreview({ url, label }: { url: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveformRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const [decodeFailed, setDecodeFailed] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`fetch ${res.status}`)
        const arrayBuffer = await res.arrayBuffer()
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
        if (!Ctx) throw new Error('AudioContext unavailable')
        const audioCtx = new Ctx()
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
        const channel = audioBuffer.getChannelData(0)
        const bars = 80
        const blockSize = Math.max(1, Math.floor(channel.length / bars))
        const samples: number[] = []
        for (let i = 0; i < bars; i++) {
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channel[i * blockSize + j] || 0)
          }
          samples.push(sum / blockSize)
        }
        const max = Math.max(...samples, 0.001)
        if (!cancelled) setPeaks(samples.map(s => s / max))
      } catch (err) {
        console.error('[audio-preview] decode failed:', err)
        if (!cancelled) setDecodeFailed(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [url])

  // Played fraction (0..1). When duration is still 0 (metadata not loaded
  // yet), treat as nothing played so the whole waveform reads as dim.
  const playedRatio = duration > 0 ? currentTime / duration : 0

  // Click anywhere on the waveform → seek the underlying <audio> to the
  // corresponding timestamp. Same logic for clicks AND drags so the user
  // can scrub by holding mouse-down + moving.
  const seekFromClientX = (clientX: number) => {
    const el = waveformRef.current
    const audio = audioRef.current
    if (!el || !audio || !duration) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
    setCurrentTime(ratio * duration)
  }

  const handleWaveformMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    seekFromClientX(e.clientX)
    const onMove = (ev: MouseEvent) => seekFromClientX(ev.clientX)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="px-3 py-4 flex flex-col gap-3">
      {/* Waveform — click anywhere to seek, drag to scrub. */}
      <div
        ref={waveformRef}
        onMouseDown={handleWaveformMouseDown}
        className="flex items-center gap-[2px] h-14 cursor-pointer relative nodrag select-none"
        title="Click or drag to seek"
      >
        {peaks ? (
          peaks.map((p, i) => {
            // Each bar represents a slice of the timeline; played bars
            // brighten, unplayed stay dim. Using i+1 means the last bar
            // only lights up when the audio is fully through.
            const isPlayed = (i + 1) / peaks.length <= playedRatio
            return (
              <div
                key={i}
                className="flex-1 rounded-sm transition-colors pointer-events-none"
                style={{
                  height: `${Math.max(6, p * 100)}%`,
                  background: isPlayed
                    ? 'rgba(251,191,36,0.85)'
                    : 'rgba(251,191,36,0.22)',
                  minWidth: 2,
                }}
              />
            )
          })
        ) : decodeFailed ? (
          <div className="w-full text-center text-[10px] font-mono text-red-400/60">
            waveform unavailable
          </div>
        ) : (
          <div className="w-full text-center text-[10px] font-mono text-muted-foreground/40">
            decoding…
          </div>
        )}

        {/* Playhead — a thin vertical line at the current playback
            position. Hidden until metadata loads so we don't show a
            playhead sitting at position 0 forever. */}
        {peaks && duration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px pointer-events-none"
            style={{
              left: `${playedRatio * 100}%`,
              background: isPlaying
                ? 'rgba(251,191,36,0.95)'
                : 'rgba(251,191,36,0.6)',
            }}
          />
        )}
      </div>

      {/* Native audio controls — still useful for play/pause toggle and
          accessibility. Timeupdate / loadedmetadata events sync state
          back into the waveform above so both stay in sync. */}
      <audio
        ref={audioRef}
        src={url}
        controls
        preload="metadata"
        className="w-full nodrag"
        style={{ height: 32 }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
        onDurationChange={e => setDuration((e.target as HTMLAudioElement).duration)}
      >
        {label}
      </audio>
    </div>
  )
}
