'use client'

import { Position, NodeProps, Handle, useReactFlow } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { Play, CaretDown, SpeakerHigh, SpeakerSlash, TextT, Image as ImageIcon, FilmStrip, CircleNotch, X, Check, ArrowsClockwise, Minus, Plus } from '@phosphor-icons/react'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { getVideoModels, getModelById, buildModelInput, type ModelConfig } from '@/lib/fal-models'

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

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  // Set true to immediately stop polling (cancel / unmount).
  const stopRef = useRef(false)
  const { setNodes, setEdges, getEdges, getNodes } = useReactFlow()
  
  // Check if there are any connected prompt nodes - compute fresh on each render
  // Accept edges that either have targetHandle='prompt-in' OR no targetHandle (for backward compatibility)
  let hasConnectedPrompts = false
  try {
    const edges = getEdges()
    const allIncomingEdges = edges.filter(edge => edge.target === id)
    const incomingPromptEdges = allIncomingEdges.filter(edge => 
      edge.targetHandle === 'prompt-in' || edge.targetHandle === null || edge.targetHandle === undefined
    )
    hasConnectedPrompts = incomingPromptEdges.length > 0
  } catch (err) {
    hasConnectedPrompts = false
  }

  // Get current model config
  const currentModel = useMemo(() => getModelById(modelId), [modelId])

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

  const shots: ShotOption[] = (data.availableShots as ShotOption[]) || [
    { id: 'shot-1', label: 'Shot 1' },
  ]
  const selectedShotId = data.shotId as string | undefined

  const handleShotSelect = (shotId: string) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, shotId } } : n))
  }

  const handleNewShot = () => {
    const newShotId = `shot-${Date.now()}`
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, shotId: newShotId } } : n))
  }

  // Persist state changes to node data
  useEffect(() => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n,
      data: { ...n.data, prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl }
    } : n))
  }, [prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl, id, setNodes])

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
    let connectedVideoUrl: string | null = null
    
    try {
      const edges = getEdges()
      const nodes = getNodes()
      
      // Get all edges where target is this node's "prompt-in" handle
      // Accept edges without targetHandle for backward compatibility (old connections)
      const incomingPromptEdges = edges.filter(
        edge => edge.target === id && (edge.targetHandle === 'prompt-in' || !edge.targetHandle)
      )
      
      // Get connected image input (from image-in handle or image-out source handle)
      const incomingImageEdges = edges.filter(
        edge => edge.target === id && (
          edge.targetHandle === 'image-in' || 
          edge.sourceHandle === 'image-out'  // Also check source handle for backward compatibility
        )
      )
      
      // Get connected video input (from video-in handle or video-out source handle)
      const incomingVideoEdges = edges.filter(
        edge => edge.target === id && (
          edge.targetHandle === 'video-in' ||
          edge.sourceHandle === 'video-out'  // Also check source handle
        )
      )
      
      // Get image URL from connected image source node
      if (incomingImageEdges.length > 0) {
        const imageEdge = incomingImageEdges[0]
        const sourceNode = nodes.find(n => n.id === imageEdge.source)
        // Generated nodes store the URL in outputUrl; reference/upload nodes in thumbnail.
        const sourceImageUrl = (sourceNode?.data?.outputUrl || sourceNode?.data?.thumbnail) as string | undefined
        if (sourceImageUrl) {
          connectedImageUrl = sourceImageUrl
        }
      }
      
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
        // Mirror this node's incoming connections onto each duplicate.
        const incoming = getEdges().filter(e => e.target === id)
        if (incoming.length) {
          const newEdges = newNodes.flatMap((nn, ni) =>
            incoming.map((e, ei) => ({ ...e, id: `${nn.id}-e${ei}-${stamp}-${ni}`, target: nn.id }))
          )
          setEdges(es => [...es, ...(newEdges as any)])
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
      <NodeActionToolbar nodeId={id} selected={selected} />

      {/* Shot selector badge */}
      <div className="absolute -top-8 left-0 flex items-center gap-2 z-10">
        <ShotSelector
          selectedShotId={selectedShotId}
          shots={shots}
          onSelect={handleShotSelect}
          onNewShot={handleNewShot}
        />
        <span className="text-[10px] font-mono text-muted-foreground/60 whitespace-nowrap">
          {(data.label as string) || 'Video Generator #1'}
        </span>
      </div>

      {/* Handles - dynamic based on model inputTypes */}
      
      {/* Text input - always shown */}
      <Handle type="target" id="prompt-in" position={Position.Left} style={{ top: 80, left: -12, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={TextT} color="rgba(168,85,247,0.8)" position="left" top={80} visible />
      
      {/* Image input - only if model supports image input */}
      {currentModel?.inputTypes.includes('image') && (
        <>
          <Handle type="target" id="image-in" position={Position.Left} style={{ top: 150, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={ImageIcon} color="rgba(96,165,250,0.8)" position="left" top={150} visible />
        </>
      )}
      
      {/* Video input - only if model supports video-to-video */}
      {currentModel?.inputTypes.includes('video') && (
        <>
          <Handle type="target" id="video-in" position={Position.Left} style={{ top: 220, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={FilmStrip} color="rgba(74,222,128,0.8)" position="left" top={220} visible />
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
        <div className="min-h-[220px] bg-[#0a0c0f] flex items-center justify-center relative">
          {outputUrl ? (
            <video 
              src={outputUrl} 
              controls 
              autoPlay 
              loop={enableLoop}
              muted={!enableAudio}
              className="w-full h-full object-contain"
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
              disabled={!prompt.trim() && !hasConnectedPrompts}
              className="w-6 h-6 rounded-full bg-accent/20 hover:bg-accent text-accent hover:text-accent-foreground flex items-center justify-center transition-colors teal-glow disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generate video"
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
