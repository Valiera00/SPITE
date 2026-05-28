'use client'

import { Position, NodeProps, Handle, useReactFlow, useNodes } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { Play, CaretDown, SpeakerHigh, SpeakerSlash, TextT, Image as ImageIcon, FilmStrip, CircleNotch, X, Check, ArrowsClockwise, Minus, Plus } from '@phosphor-icons/react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { Lightbox } from '../lightbox'
import { labelFromPrompt, DEFAULT_VIDEO_LABEL } from '@/lib/auto-name'
import { getVideoModels, getModelById, buildModelInput, type ModelConfig } from '@/lib/fal-models'
import { captureVideoThumbnail } from '@/lib/video-thumbnail'

const VIDEO_MODELS = getVideoModels()

type GenerationStatus = 'idle' | 'submitting' | 'in_queue' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

function ControlSelect({ 
  value, 
  options, 
  onChange,
  disabled 
}: { 
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button 
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 h-6 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-mono text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {value}
        <CaretDown size={8} weight="bold" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-[#1a1d21] border border-white/10 rounded-lg py-1 z-50 min-w-[120px] shadow-xl max-h-[200px] overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-mono hover:bg-white/10 transition-colors ${opt.value === value ? 'text-accent' : 'text-muted-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HandleIcon({ icon: Icon, color, position, top, visible = true }: { 
  icon: React.ElementType
  color: string
  position: 'left' | 'right'
  top: number
  visible?: boolean 
}) {
  if (!visible) return null
  
  return (
    <div
      className="absolute flex items-center justify-center"
      style={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: '#111316',
        border: `1.5px solid ${color}`,
        top: top,
        transform: 'translateY(-50%)',
        [position === 'left' ? 'left' : 'right']: -12,
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <Icon size={11} weight="bold" style={{ color }} />
    </div>
  )
}

function StatusBadge({ status, progress }: { status: GenerationStatus; progress?: number }) {
  if (status === 'idle') return null
  
  const statusConfig: Record<GenerationStatus, { label: string; color: string }> = {
    idle: { label: '', color: '' },
    submitting: { label: 'Submitting...', color: 'text-blue-400' },
    in_queue: { label: 'In Queue', color: 'text-yellow-400' },
    in_progress: { label: progress ? `${Math.round(progress * 100)}%` : 'Generating...', color: 'text-purple-400' },
    completed: { label: 'Done', color: 'text-green-400' },
    failed: { label: 'Failed', color: 'text-red-400' },
    cancelled: { label: 'Cancelled', color: 'text-gray-400' },
  }

  const config = statusConfig[status]

  return (
    <div className={`flex items-center gap-1.5 text-[9px] font-mono ${config.color}`}>
      {(status === 'submitting' || status === 'in_queue' || status === 'in_progress') && (
        <CircleNotch size={10} className="animate-spin" />
      )}
      {status === 'completed' && <Check size={10} weight="bold" />}
      {status === 'failed' && <X size={10} weight="bold" />}
      {config.label}
    </div>
  )
}

export function VideoNode({ id, data, selected }: NodeProps) {
  const params = useParams()
  // Route segment is [id], so the param is `id` (not `projectId`).
  const projectId = params.id as string
  const [prompt, setPrompt] = useState((data.prompt as string) || '')
  const [modelId, setModelId] = useState((data.modelId as string) || 'seedance-1.5')
  const [duration, setDuration] = useState((data.duration as string) || '')
  const [aspectRatio, setAspectRatio] = useState((data.aspectRatio as string) || '')
  const [resolution, setResolution] = useState((data.resolution as string) || '')
  const [enableAudio, setEnableAudio] = useState((data.enableAudio as boolean) || false)
  const [enableLoop, setEnableLoop] = useState((data.enableLoop as boolean) || false)
  const [numVideos, setNumVideos] = useState((data.numVideos as number) || 1)
  
  const [status, setStatus] = useState<GenerationStatus>('idle')
  const [progress, setProgress] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>((data.outputUrl as string) || null)
  const [requestId, setRequestId] = useState<string | null>(null)
  // The exact fal queue path to poll, as told to us by the submit response.
  const [falEndpoint, setFalEndpoint] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  // Set true to immediately stop polling (cancel / unmount).
  const stopRef = useRef(false)
  const { setNodes, getEdges, getNodes } = useReactFlow()
  
  // Check connection states fresh on each render
  let hasConnectedPrompts = false
  let hasConnectedFirstFrame = false
  let hasConnectedReferences = false
  try {
    const edges = getEdges()
    const allIncomingEdges = edges.filter(edge => edge.target === id)
    hasConnectedPrompts = allIncomingEdges.some(e =>
      e.targetHandle === 'prompt-in' || e.targetHandle === null || e.targetHandle === undefined
    )
    hasConnectedFirstFrame = allIncomingEdges.some(e =>
      e.targetHandle === 'image-in' ||
      (e.sourceHandle === 'image-out' && e.targetHandle !== 'end-frame-in' && e.targetHandle !== 'reference-in' && e.targetHandle !== 'video-in')
    )
    hasConnectedReferences = allIncomingEdges.some(e => e.targetHandle === 'reference-in')
  } catch { /* ignore */ }

  // Get current model config
  const currentModel = useMemo(() => getModelById(modelId), [modelId])

  // Kling v3 references ride the image-to-video endpoint, which requires a
  // first frame. Block generation (with a clear message) when refs are
  // connected but no first frame, so the user gets a helpful error not a
  // confusing fal validation failure.
  const refsRequireFirstFrame = !!currentModel?.referenceParam && currentModel.referenceParam === 'elements' && !currentModel.referenceModel
  const blockedNoFirstFrame = refsRequireFirstFrame && hasConnectedReferences && !hasConnectedFirstFrame

  // Reset settings when model changes
  useEffect(() => {
    if (currentModel) {
      setAspectRatio(currentModel.defaultAspectRatio)
      setDuration(currentModel.defaultDuration || '')
      setResolution(currentModel.defaultResolution || '')
      setEnableAudio(false)
      setEnableLoop(false)
    }
  }, [currentModel])

  const selectedShotId = data.shotId as string | undefined
  const allNodes = useNodes()

  // Build the shot list for this scene: 1..max with thumbnails on the slots
  // that have a tagged node. Empty slots stay selectable so the user can
  // claim a gap (e.g. add a node at shot 5 between existing shots 1 and 10).
  const shots: ShotOption[] = useMemo(() => {
    const self = allNodes.find((n: any) => n.id === id)
    const sceneId = (self?.data as any)?.sceneId
    const byShot = new Map<number, { thumb?: string; hasVideo: boolean }>()
    let maxNum = 0
    for (const n of allNodes) {
      if (sceneId && (n.data as any)?.sceneId !== sceneId) continue
      const m = String((n.data as any)?.shotId || '').match(/^shot-(\d+)$/)
      if (!m) continue
      const num = parseInt(m[1])
      if (num > maxNum) maxNum = num
      const candidateThumb = n.type === 'videoGen'
        ? ((n.data as any)?.videoThumbnail || (n.data as any)?.thumbnail) as string | undefined
        : ((n.data as any)?.outputUrl || (n.data as any)?.thumbnail) as string | undefined
      const candidateHasVideo = n.type === 'videoGen'
      const existing = byShot.get(num)
      if (!existing) {
        byShot.set(num, { thumb: candidateThumb, hasVideo: candidateHasVideo })
      } else if (!existing.thumb && candidateThumb) {
        byShot.set(num, { thumb: candidateThumb, hasVideo: existing.hasVideo || candidateHasVideo })
      }
    }
    if (maxNum === 0) return [{ id: 'shot-1', label: 'Shot 1' }]
    const list: ShotOption[] = []
    for (let i = 1; i <= maxNum; i++) {
      const info = byShot.get(i)
      list.push({ id: `shot-${i}`, label: `Shot ${i}`, thumbnail: info?.thumb, hasVideo: info?.hasVideo })
    }
    return list
  }, [allNodes, id])

  const handleShotSelect = (shotId: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, shotId } } : n))
  }

  const handleNewShot = () => {
    // Always create the NEXT number after the highest existing shot in the
    // scene — so shots monotonically increase (shot 99 → New Shot creates
    // shot 100). Gaps between numbers are intentional and shown as empty
    // placeholders in the timeline.
    setNodes(ns => {
      const self = ns.find(n => n.id === id)
      const sceneId = self?.data?.sceneId
      let maxNum = 0
      for (const n of ns) {
        if (sceneId && n.data?.sceneId !== sceneId) continue
        const m = String(n.data?.shotId || '').match(/^shot-(\d+)$/)
        if (m) maxNum = Math.max(maxNum, parseInt(m[1]))
      }
      const next = maxNum + 1
      return ns.map(n => n.id === id ? { ...n, data: { ...n.data, shotId: `shot-${next}` } } : n)
    })
  }

  // Persist state changes to node data
  useEffect(() => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n,
      data: { ...n.data, prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl }
    } : n))
  }, [prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl, id, setNodes])

  // Auto-name: once a generation completes, replace the default
  // "Video Generator #N" label with the first few words of the prompt.
  // User-renamed labels are left alone.
  useEffect(() => {
    if (!outputUrl) return
    const current = (data.label as string) || ''
    if (current && !DEFAULT_VIDEO_LABEL.test(current)) return
    const derived = labelFromPrompt(prompt)
    if (!derived || derived === current) return
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, label: derived } } : n))
  }, [outputUrl, prompt, data.label, id, setNodes])

  const handleRename = () => {
    setLabelDraft((data.label as string) || '')
    setIsRenaming(true)
  }
  const commitRename = () => {
    const next = labelDraft.trim()
    setIsRenaming(false)
    if (!next) return
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, label: next } } : n))
  }

  // Capture a freeze-frame from the rendered video so the scene-shot bar
  // can show a thumbnail (an <img> can't render an mp4). Re-captures when
  // outputUrl changes (new generation); skips when the stored thumbnail
  // already matches the current outputUrl (after reload).
  useEffect(() => {
    if (!outputUrl) return
    if (data.videoThumbnailFor === outputUrl && data.videoThumbnail) return
    let cancelled = false
    captureVideoThumbnail(outputUrl).then(thumb => {
      if (cancelled || !thumb) return
      setNodes(ns => ns.map(n => n.id === id ? {
        ...n,
        data: { ...n.data, videoThumbnail: thumb, videoThumbnailFor: outputUrl }
      } : n))
    })
    return () => { cancelled = true }
  }, [outputUrl, data.videoThumbnail, data.videoThumbnailFor, id, setNodes])

  // If this node was spawned for a batch generation, resume polling its job.
  useEffect(() => {
    const pending = data.pendingRequestId as string | undefined
    if (pending && !outputUrl) {
      setFalEndpoint((data.pendingFalEndpoint as string) || null)
      setRequestId(pending)
      setStatus('in_queue')
      setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, pendingRequestId: undefined, pendingFalEndpoint: undefined } } : n))
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll for status
  const pollStatus = useCallback(async (reqId: string, falModelId: string) => {
    if (stopRef.current) return true
    try {
        const response = await fetch(`/api/generate/status?request_id=${reqId}&model=${encodeURIComponent(falModelId)}&projectId=${projectId}&prompt=${encodeURIComponent(prompt)}`)
      const result = await response.json()

      // Cancelled while this request was in flight — drop the result.
      if (stopRef.current) return true

      if (result.error) {
        setStatus('failed')
        setError(result.error)
        return true
      }

      if (result.status === 'COMPLETED') {
        setStatus('completed')
        setProgress(undefined)
        // API returns { output: { videos: [...], url: '...' } }
        const videoUrl = result.output?.url || result.output?.videos?.[0] || result.result?.video?.url || result.result?.video_url
        if (videoUrl) {
          setOutputUrl(videoUrl)
        }
        return true
      }

      if (result.status === 'FAILED') {
        setStatus('failed')
        setError(result.error || 'Generation failed')
        return true
      }

      if (result.status === 'IN_PROGRESS') {
        setStatus('in_progress')
        if (result.progress !== undefined) {
          setProgress(result.progress)
        }
      } else if (result.status === 'IN_QUEUE') {
        setStatus('in_queue')
      }

      return false
    } catch (err) {
      console.error('[v0] Poll error:', err)
      return false
    }
  }, [])

  // Start polling when we have a request_id
  useEffect(() => {
    if (!requestId || !currentModel) return
    stopRef.current = false
    const pollModel = falEndpoint || currentModel.falModel

    const poll = async () => {
      if (stopRef.current) return
      const shouldStop = await pollStatus(requestId, pollModel)
      if (!shouldStop && !stopRef.current) {
        pollingRef.current = setTimeout(poll, 2000)
      }
    }

    // Wait 4 seconds before first poll to let job start processing
    pollingRef.current = setTimeout(poll, 4000)

    return () => {
      stopRef.current = true
      if (pollingRef.current) {
        clearTimeout(pollingRef.current)
      }
    }
  }, [requestId, currentModel, falEndpoint, pollStatus])

  const handleGenerate = async () => {
    // Compile prompts from connected nodes and this node's prompt
    let compiledPrompt = ''
    let connectedImageUrl: string | null = null
    let connectedEndImageUrl: string | null = null
    let connectedReferenceUrls: string[] = []
    let connectedVideoUrl: string | null = null

    const urlOfSource = (edge: any) => {
      const sourceNode = nodes.find(n => n.id === edge.source)
      // Generated nodes store the URL in outputUrl; reference/upload nodes in thumbnail.
      return (sourceNode?.data?.outputUrl || sourceNode?.data?.thumbnail) as string | undefined
    }

    let nodes: any[] = []
    try {
      const edges = getEdges()
      nodes = getNodes()

      // Get all edges where target is this node's "prompt-in" handle
      // Accept edges without targetHandle for backward compatibility (old connections)
      const incomingPromptEdges = edges.filter(
        edge => edge.target === id && (edge.targetHandle === 'prompt-in' || !edge.targetHandle)
      )

      // End frame (its own handle) — matched first so it isn't mistaken for the first frame.
      const incomingEndFrameEdges = edges.filter(
        edge => edge.target === id && edge.targetHandle === 'end-frame-in'
      )

      // Reference images (own handle, multiple allowed).
      const incomingReferenceEdges = edges.filter(
        edge => edge.target === id && edge.targetHandle === 'reference-in'
      )

      // First frame (image-in). The image-out source fallback is for old
      // connections, but must NOT swallow end-frame / reference / video edges.
      const incomingImageEdges = edges.filter(
        edge => edge.target === id && (
          edge.targetHandle === 'image-in' ||
          (edge.sourceHandle === 'image-out' && edge.targetHandle !== 'end-frame-in' && edge.targetHandle !== 'reference-in' && edge.targetHandle !== 'video-in')
        )
      )

      // Get connected video input (from video-in handle or video-out source handle)
      const incomingVideoEdges = edges.filter(
        edge => edge.target === id && (
          edge.targetHandle === 'video-in' ||
          edge.sourceHandle === 'video-out'  // Also check source handle
        )
      )

      // Get image URL from connected first-frame source node
      if (incomingImageEdges.length > 0) {
        const url = urlOfSource(incomingImageEdges[0])
        if (url) connectedImageUrl = url
      }

      // Get end-frame URL
      if (incomingEndFrameEdges.length > 0) {
        const url = urlOfSource(incomingEndFrameEdges[0])
        if (url) connectedEndImageUrl = url
      }

      // Collect all connected reference image URLs
      connectedReferenceUrls = incomingReferenceEdges
        .map(e => urlOfSource(e))
        .filter((u): u is string => !!u)

      // Get video URL from connected video source node
      if (incomingVideoEdges.length > 0) {
        const videoEdge = incomingVideoEdges[0]
        const sourceNode = nodes.find(n => n.id === videoEdge.source)
        const sourceVideoUrl = (sourceNode?.data?.outputUrl || sourceNode?.data?.thumbnail) as string | undefined
        if (sourceVideoUrl) {
          connectedVideoUrl = sourceVideoUrl
        }
      }
      
      // Sort by the order edges were created (which is their index in the array)
      // This preserves connection order
      incomingPromptEdges.forEach((edge, index) => {
        const sourceNode = nodes.find(n => n.id === edge.source)
        // For PromptNode, text is stored in data.text; for other nodes, use data.prompt
        const sourcePrompt = (sourceNode?.data?.text || sourceNode?.data?.prompt) as string | undefined
        if (sourcePrompt && typeof sourcePrompt === 'string') {
          if (index > 0) compiledPrompt += ' '
          compiledPrompt += sourcePrompt.trim()
        }
      })
      
      // Add this node's prompt at the end
      if (prompt.trim()) {
        if (compiledPrompt) compiledPrompt += ' '
        compiledPrompt += prompt.trim()
      }
    } catch (error) {
      console.error('[v0] Error compiling prompts:', error)
      compiledPrompt = prompt.trim()
    }

    if (!compiledPrompt) {
      setError('Please enter a prompt')
      return
    }

    if (!currentModel) {
      setError('Please select a model')
      return
    }

    setStatus('submitting')
    setError(null)
    setOutputUrl(null)
    setProgress(undefined)

    try {
      // Send RAW settings; the server builds the model-specific payload.
      const body = JSON.stringify({
        modelId,
        prompt: compiledPrompt,
        referenceImageUrl: connectedImageUrl,
        endImageUrl: connectedEndImageUrl,
        referenceImageUrls: connectedReferenceUrls.length ? connectedReferenceUrls : undefined,
        settings: {
          aspectRatio,
          duration,
          resolution,
          enableAudio,
          enableLoop,
          videoUrl: connectedVideoUrl || undefined,
        },
      })

      // Each video is a separate fal job. Fire `numVideos` of them in parallel.
      const count = Math.max(1, Math.min(4, numVideos))
      const results = await Promise.all(
        Array.from({ length: count }, () =>
          fetch('/api/generate/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.json())
        )
      )
      const ok = results.filter(r => r.request_id)
      if (ok.length === 0) {
        setStatus('failed')
        setError(results[0]?.error || 'Failed to submit job')
        return
      }

      // This node tracks the first job.
      setFalEndpoint(ok[0].model || currentModel.falModel)
      setRequestId(ok[0].request_id)
      setStatus('in_queue')

      // Extra jobs become duplicate video nodes (in a grid) that each poll
      // their own request and fill in when done.
      if (ok.length > 1) {
        const extra = ok.slice(1)
        const self = getNodes().find(nd => nd.id === id)
        const baseX = self?.position?.x ?? 0
        const baseY = self?.position?.y ?? 0
        const colGap = 400
        const rowGap = 540
        const cols = 3
        const stamp = Date.now()
        const { shotId, outputUrl: _drop, ...restData } = ((self?.data || {}) as Record<string, unknown>)
        const newNodes = extra.map((res, idx) => {
          const slot = idx + 1
          const col = slot % cols
          const row = Math.floor(slot / cols)
          return {
            id: `${id}-v${stamp}-${idx}`,
            type: 'videoGen',
            position: { x: baseX + col * colGap, y: baseY + row * rowGap },
            data: {
              ...restData,
              prompt: compiledPrompt,
              pendingRequestId: res.request_id,
              pendingFalEndpoint: res.model || currentModel.falModel,
            },
          }
        })
        setNodes(ns => [...ns, ...(newNodes as any)])
        // Mirror this node's incoming connections onto each duplicate
        // (routed through the canvas, which owns the edge state).
        const incoming = getEdges().filter(e => e.target === id)
        if (incoming.length) {
          const newEdges = newNodes.flatMap((nn, ni) =>
            incoming.map((e, ei) => ({ ...e, id: `${nn.id}-e${ei}-${stamp}-${ni}`, target: nn.id }))
          )
          window.dispatchEvent(new CustomEvent('frame-add-edges', { detail: { edges: newEdges } }))
        }
      }
    } catch (err: any) {
      setStatus('failed')
      setError(err.message || 'Failed to submit job')
    }
  }

  const handleCancel = async () => {
    if (!requestId || !currentModel) return

    // Stop polling immediately and locally so the UI reliably unsticks.
    stopRef.current = true
    if (pollingRef.current) clearTimeout(pollingRef.current)
    setStatus('cancelled')
    toast.warning('Generation cancelled', { description: currentModel.name })
    const reqId = requestId
    const cancelModel = falEndpoint || currentModel.falModel
    setRequestId(null)

    try {
      await fetch('/api/generate/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: reqId, model: cancelModel }),
      })
    } catch (err) {
      console.error('[v0] Cancel error:', err)
    }
  }

  const isGenerating = status === 'submitting' || status === 'in_queue' || status === 'in_progress'
  const isTaggedToShot = !!selectedShotId

  // Build options from current model's config
  const modelOptions = VIDEO_MODELS.map(m => ({ value: m.id, label: m.name }))
  const aspectOptions = currentModel?.aspectRatios.map(a => ({ value: a, label: a })) || []
  const durationOptions = currentModel?.durations?.map(d => ({ value: d, label: d })) || []
  const resolutionOptions = currentModel?.resolutions?.map(r => ({ value: r, label: r })) || []

  return (
    <div className="relative group" style={{ width: 420 }}>
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        nodeLabel={(data.label as string) || 'Video Generator'}
        assetUrl={outputUrl || undefined}
        assetType="video"
        onRename={handleRename}
        onViewFullscreen={outputUrl ? () => setLightboxOpen(true) : undefined}
      />

      <Lightbox
        open={lightboxOpen}
        url={outputUrl}
        type="video"
        onClose={() => setLightboxOpen(false)}
      />

      {/* Shot selector badge */}
      <div className="absolute -top-8 left-0 flex items-center gap-2 z-10">
        <ShotSelector
          selectedShotId={selectedShotId}
          shots={shots}
          onSelect={handleShotSelect}
          onNewShot={handleNewShot}
        />
        {isRenaming ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setIsRenaming(false)
            }}
            className="text-[10px] font-mono text-foreground bg-transparent border-b border-accent/60 outline-none min-w-[140px]"
          />
        ) : (
          <span
            onDoubleClick={handleRename}
            className="text-[10px] font-mono text-muted-foreground/60 whitespace-nowrap cursor-text hover:text-foreground transition-colors"
            title="Double-click to rename"
          >
            {(data.label as string) || 'Video Generator #1'}
          </span>
        )}
      </div>

      {/* Handles - dynamic based on model inputTypes */}
      
      {/* Text input - always shown */}
      <Handle type="target" id="prompt-in" position={Position.Left} style={{ top: 80, left: -12, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={TextT} color="rgba(168,85,247,0.8)" position="left" top={80} visible />
      
      {/* First frame (blue) - only if model supports image input */}
      {currentModel?.inputTypes.includes('image') && (
        <>
          <Handle type="target" id="image-in" title="First frame" position={Position.Left} style={{ top: 150, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={ImageIcon} color="rgba(96,165,250,0.8)" position="left" top={150} visible />
        </>
      )}

      {/* End frame (amber) - video models that support a last frame */}
      {currentModel?.category === 'video' && !currentModel.id.startsWith('minimax') && (
        <>
          <Handle type="target" id="end-frame-in" title="End frame" position={Position.Left} style={{ top: 200, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={ImageIcon} color="rgba(251,191,36,0.9)" position="left" top={200} visible />
        </>
      )}

      {/* Reference images (pink) - models that support subject/style refs.
          Accepts multiple image connections. */}
      {currentModel?.referenceParam && (
        <>
          <Handle type="target" id="reference-in" title="Reference image(s)" position={Position.Left} style={{ top: 250, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={ImageIcon} color="rgba(236,72,153,0.9)" position="left" top={250} visible />
        </>
      )}

      {/* Video input (green) - only if model supports video-to-video */}
      {currentModel?.inputTypes.includes('video') && (
        <>
          <Handle type="target" id="video-in" title="Source video" position={Position.Left} style={{ top: 310, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={FilmStrip} color="rgba(74,222,128,0.8)" position="left" top={310} visible />
        </>
      )}
      
      {/* Video output - always shown */}
      <Handle type="source" id="video-out" position={Position.Right} style={{ top: 150, right: -12, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={FilmStrip} color="rgba(74,222,128,0.8)" position="right" top={150} visible />

      {/* Card content */}
      <div
        className="flex flex-col rounded-xl overflow-hidden transition-all duration-200"
        style={{
          background: '#0D0F12',
          border: isTaggedToShot 
            ? '1.5px solid rgba(251,191,36,0.7)' 
            : selected 
              ? '1.5px solid rgba(168,85,247,0.85)' 
              : '1.5px solid rgba(168,85,247,0.25)',
          boxShadow: isTaggedToShot
            ? '0 0 0 1px rgba(251,191,36,0.2), 0 0 20px rgba(251,191,36,0.25), 0 0 40px rgba(251,191,36,0.1)'
            : selected 
              ? '0 0 0 1px rgba(168,85,247,0.2), 0 0 24px rgba(168,85,247,0.15)' 
              : 'none',
        }}
      >
        {/* Preview area */}
        <div
          className="min-h-[220px] bg-[#0a0c0f] flex items-center justify-center relative"
          onDoubleClick={() => { if (outputUrl) setLightboxOpen(true) }}
        >
          {outputUrl ? (
            <video
              src={outputUrl}
              controls
              autoPlay
              loop={enableLoop}
              muted={!enableAudio}
              className="w-full h-full object-contain cursor-zoom-in"
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              {isGenerating ? (
                <>
                  <CircleNotch size={24} className="animate-spin text-accent/60" />
                  <StatusBadge status={status} progress={progress} />
                </>
              ) : (
                <span className="text-[11px] font-mono text-muted-foreground/30">No output yet</span>
              )}
            </div>
          )}
          
          {error && (
            <div className="absolute bottom-2 left-2 right-2 bg-red-500/20 border border-red-500/30 rounded px-2 py-1">
              <span className="text-[9px] font-mono text-red-400">{error}</span>
            </div>
          )}

          {!error && blockedNoFirstFrame && (
            <div className="absolute bottom-2 left-2 right-2 bg-amber-500/20 border border-amber-500/30 rounded px-2 py-1">
              <span className="text-[9px] font-mono text-amber-300">
                {currentModel?.name} needs a first frame when references are connected. Wire an image into the blue handle.
              </span>
            </div>
          )}
        </div>

        {/* Prompt input */}
        <div className="px-3 pt-3 pb-2">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the video you want to generate..."
            disabled={isGenerating}
            className="w-full bg-transparent resize-none outline-none text-[11px] font-mono text-foreground/80 placeholder:text-muted-foreground/40 leading-relaxed disabled:opacity-50"
            rows={2}
          />
        </div>

        {/* Controls - Dynamic based on model */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Video count counter */}
            <div className="flex items-center gap-0.5 px-1.5 h-6 rounded-md bg-white/5 text-[10px] font-mono text-muted-foreground">
              <button
                onClick={() => setNumVideos(n => Math.max(1, n - 1))}
                disabled={isGenerating || numVideos <= 1}
                className="w-4 h-4 flex items-center justify-center hover:text-foreground disabled:opacity-30"
              >
                <Minus size={8} weight="bold" />
              </button>
              <span className="w-4 text-center">x{numVideos}</span>
              <button
                onClick={() => setNumVideos(n => Math.min(4, n + 1))}
                disabled={isGenerating || numVideos >= 4}
                className="w-4 h-4 flex items-center justify-center hover:text-foreground disabled:opacity-30"
              >
                <Plus size={8} weight="bold" />
              </button>
            </div>

            {/* Model selector */}
            <ControlSelect
              value={currentModel?.name || modelId}
              options={modelOptions}
              onChange={setModelId}
              disabled={isGenerating}
            />
            
            {/* Duration - only if model supports it */}
            {durationOptions.length > 0 && (
              <ControlSelect 
                value={duration || currentModel?.defaultDuration || ''} 
                options={durationOptions}
                onChange={setDuration}
                disabled={isGenerating}
              />
            )}
            
            {/* Aspect ratio */}
            {aspectOptions.length > 0 && (
              <ControlSelect 
                value={aspectRatio || currentModel?.defaultAspectRatio || ''} 
                options={aspectOptions}
                onChange={setAspectRatio}
                disabled={isGenerating}
              />
            )}
            
            {/* Resolution - only if model supports it */}
            {resolutionOptions.length > 0 && (
              <ControlSelect 
                value={resolution || currentModel?.defaultResolution || ''} 
                options={resolutionOptions}
                onChange={setResolution}
                disabled={isGenerating}
              />
            )}
            
            {/* Audio toggle - only if model supports audio generation */}
            {currentModel?.supportsAudio && (
              <button
                onClick={() => setEnableAudio(a => !a)}
                disabled={isGenerating}
                className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors disabled:opacity-50 ${
                  enableAudio ? 'bg-accent/20 text-accent' : 'bg-white/5 hover:bg-white/10 text-muted-foreground'
                }`}
                title="Generate with audio"
              >
                {enableAudio
                  ? <SpeakerHigh size={11} weight="fill" />
                  : <SpeakerSlash size={11} weight="thin" />
                }
              </button>
            )}
            
            {/* Loop toggle - only if model supports loop */}
            {currentModel?.supportsLoop && (
              <button
                onClick={() => setEnableLoop(l => !l)}
                disabled={isGenerating}
                className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors disabled:opacity-50 ${
                  enableLoop ? 'bg-accent/20 text-accent' : 'bg-white/5 hover:bg-white/10 text-muted-foreground'
                }`}
                title="Generate looping video"
              >
                <ArrowsClockwise size={11} weight={enableLoop ? 'fill' : 'thin'} />
              </button>
            )}
          </div>
          
          {/* Generate / Cancel button */}
          {isGenerating ? (
            <button 
              onClick={handleCancel}
              className="w-6 h-6 rounded-full bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-colors"
              title="Cancel generation"
            >
              <X size={10} weight="bold" />
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={(!prompt.trim() && !hasConnectedPrompts) || blockedNoFirstFrame}
              className="w-6 h-6 rounded-full bg-accent/20 hover:bg-accent text-accent hover:text-accent-foreground flex items-center justify-center transition-colors teal-glow disabled:opacity-50 disabled:cursor-not-allowed"
              title={blockedNoFirstFrame
                ? `${currentModel?.name} needs a first frame when references are connected — wire an image into the blue First frame handle.`
                : 'Generate video'}
            >
              <Play size={10} weight="fill" />
            </button>
          )}
        </div>
      </div>

      {/* Resize handle - quarter circle arc hugging the corner */}
      <div
        className="nodrag absolute opacity-0 group-hover:opacity-100 transition-opacity cursor-se-resize"
        style={{ bottom: -10, right: -10 }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          // TODO: Add resize logic if needed
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
    </div>
  )
}

VideoNode.displayName = 'VideoNode'
