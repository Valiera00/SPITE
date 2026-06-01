'use client'

import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { Play, CaretDown, Minus, Plus, TextT, Image as ImageIcon, CircleNotch, X, Check, ArrowsClockwise } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { useSceneShots } from './use-scene-shots'
import { Lightbox } from '../lightbox'
import { MentionTextarea, type Mention } from '../mention-textarea'
import { useProjectFolders } from '@/hooks/use-project-folders'
import { labelFromPrompt, DEFAULT_IMAGE_LABEL } from '@/lib/auto-name'
import { getImageModels, getModelById, buildModelInput, type ModelConfig } from '@/lib/fal-models'
import { compileMentionsForModel } from '@/lib/mention-prompt'

const IMAGE_MODELS = getImageModels()

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

function ImageNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  // Route segment is [id], so the param is `id` (not `projectId`).
  const projectId = params.id as string
  const [prompt, setPrompt] = useState((data.prompt as string) || '')
  const [mentions, setMentions] = useState<Mention[]>((data.mentions as Mention[]) || [])
  const { folders } = useProjectFolders(projectId)
  const [modelId, setModelId] = useState((data.modelId as string) || 'nano-banana-pro')
  const [aspectRatio, setAspectRatio] = useState((data.aspectRatio as string) || '')
  const [resolution, setResolution] = useState((data.resolution as string) || '')
  const [numImages, setNumImages] = useState((data.numImages as number) || 1)
  
  const [status, setStatus] = useState<GenerationStatus>('idle')
  const [progress, setProgress] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>((data.outputUrl as string) || null)
  const [requestId, setRequestId] = useState<string | null>(null)
  // The exact fal queue path to poll, as told to us by the submit response.
  const [falEndpoint, setFalEndpoint] = useState<string | null>(null)
  const [imageAspect, setImageAspect] = useState<number | null>(null) // null = no image yet
  const [nodeWidth, setNodeWidth] = useState<number>((data.width as number) || 320)
  const [isResizing, setIsResizing] = useState(false)
  const [showResizeHandle, setShowResizeHandle] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  // Set true to immediately stop polling (cancel / unmount), so an in-flight
  // status check can't reschedule itself or apply a late result.
  const stopRef = useRef(false)
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const { setNodes, getEdges, getNodes } = useReactFlow()
  
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
    console.log('[v0] Error checking connected prompts:', err)
    hasConnectedPrompts = false
  }

  // Handle mouse move for resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStartRef.current = { x: e.clientX, width: nodeWidth }
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeStartRef.current) return
      const delta = moveEvent.clientX - resizeStartRef.current.x
      const newWidth = Math.max(240, Math.min(800, resizeStartRef.current.width + delta))
      setNodeWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
      resizeStartRef.current = null
      // Persist the width change
      setNodes(ns => ns.map(n => n.id === id ? { 
        ...n, 
        data: { ...n.data, width: nodeWidth } 
      } : n))
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [nodeWidth, id, setNodes])

  // Sync outputUrl from data prop (for loaded canvases)
  useEffect(() => {
    if (data.outputUrl && data.outputUrl !== outputUrl) {
      setOutputUrl(data.outputUrl as string)
    }
  }, [data.outputUrl])

  // Resume polling after a page refresh: if the saved data has a pending
  // request id, pick up the in-flight job. We do NOT clear pendingRequestId
  // here — the data stays on the node until the generation actually
  // resolves (success / failure / cancel), so a second refresh resumes too.
  useEffect(() => {
    const pending = data.pendingRequestId as string | undefined
    if (pending && !outputUrl && !requestId) {
      setFalEndpoint((data.pendingFalEndpoint as string) || null)
      setRequestId(pending)
      setStatus('in_queue')
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  
  // Sync outputUrl TO node data when it changes (for connected nodes to read)
  useEffect(() => {
    if (outputUrl && outputUrl !== data.outputUrl) {
      setNodes(nodes => nodes.map(n => 
        n.id === id ? { ...n, data: { ...n.data, outputUrl } } : n
      ))
    }
  }, [outputUrl, id, setNodes, data.outputUrl])

  // Get current model config
  const currentModel = useMemo(() => getModelById(modelId), [modelId])

  // Reset aspect/resolution when the USER picks a new model. Skip the
  // initial mount so saved settings on a reloaded or duplicated node aren't
  // immediately clobbered by model defaults.
  const prevModelIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentModel) return
    if (prevModelIdRef.current === null) {
      prevModelIdRef.current = currentModel.id
      return
    }
    if (prevModelIdRef.current !== currentModel.id) {
      setAspectRatio(currentModel.defaultAspectRatio)
      setResolution(currentModel.defaultResolution || '')
      prevModelIdRef.current = currentModel.id
    }
  }, [currentModel])

  const selectedShotId = data.shotId as string | undefined
  // useNodes() would re-render this component on every sibling node change
  // (prompt keystrokes, generation status updates, etc.). useSceneShots
  // subscribes only to a string signature of shot-relevant fields.
  const shots = useSceneShots(id)

  const handleShotSelect = (shotId: string) => {
    // Empty string from the selector means "unassign from this shot".
    // Storing undefined keeps the data object clean (no stray empty
    // strings ending up in exports/snapshots) and matches every other
    // code path that checks for shotId via truthiness.
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n,
      data: { ...n.data, shotId: shotId || undefined },
    } : n))
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
      data: { ...n.data, prompt, modelId, aspectRatio, resolution, numImages, outputUrl, mentions }
    } : n))
  }, [prompt, modelId, aspectRatio, resolution, numImages, outputUrl, mentions, id, setNodes])

  // Auto-name: once a generation completes, replace the default
  // "Image Generator #N" label with the first few words of the prompt.
  // User-renamed labels are left alone.
  useEffect(() => {
    if (!outputUrl) return
    const current = (data.label as string) || ''
    if (current && !DEFAULT_IMAGE_LABEL.test(current)) return
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

  // Drop the persisted in-flight job marker once a generation resolves
  // (success / failure / cancel) so a future refresh doesn't try to
  // resume a completed job.
  const clearPending = useCallback(() => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n,
      data: { ...n.data, pendingRequestId: undefined, pendingFalEndpoint: undefined },
    } : n))
  }, [id, setNodes])

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
        clearPending()
        return true
      }

      if (result.status === 'COMPLETED') {
        setStatus('completed')
        setProgress(undefined)
        clearPending()
        // API returns { output: { images: [...], url: '...' } }
        const images: string[] = (result.output?.images?.length
          ? result.output.images
          : (result.output?.url ? [result.output.url] : []))
        if (images.length) {
          setOutputUrl(images[0])
          // For batch generations, drop the extra results as duplicate nodes
          // laid out in a neat grid next to this one.
          if (images.length > 1) {
            const extra = images.slice(1)
            const self = getNodes().find(n => n.id === id)
            const baseX = self?.position?.x ?? 0
            const baseY = self?.position?.y ?? 0
            const w = (self?.data?.width as number) || nodeWidth || 320
            const colGap = w + 40
            const rowGap = 520
            const cols = 3
            const stamp = Date.now()
            const newNodes = extra.map((url, idx) => {
              const slot = idx + 1 // slot 0 = this original node (grid top-left)
              const col = slot % cols
              const row = Math.floor(slot / cols)
              const { shotId, ...restData } = (self?.data || {}) as Record<string, unknown>
              return {
                id: `${id}-v${stamp}-${idx}`,
                type: 'imageGen',
                position: { x: baseX + col * colGap, y: baseY + row * rowGap },
                data: { ...restData, outputUrl: url, width: w },
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
        }
        return true
      }

      if (result.status === 'FAILED') {
        setStatus('failed')
        setError(result.error || 'Generation failed')
        clearPending()
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
  }, [clearPending])

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
    
    try {
      const edges = getEdges()
      const nodes = getNodes()
      
      // Get all edges where target is this node's "prompt-in" handle
      // Accept edges without targetHandle for backward compatibility (old connections)
      const incomingPromptEdges = edges.filter(
        edge => edge.target === id && (edge.targetHandle === 'prompt-in' || !edge.targetHandle)
      )
      
      // Get connected image input (from image-in handle on THIS node)
      const incomingImageEdges = edges.filter(
        edge => edge.target === id && edge.targetHandle === 'image-in'
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

    // Folder-mention refs: every selected asset URL across all local
    // @mentions, plus any @Folder tokens appearing in the compiled prompt
    // (forwarded from a connected prompt-node — those use the folder's
    // full asset list since the prompt-node has no per-asset picker).
    //
    // compileMentionsForModel returns ordered reference *groups* (one per
    // mention) AND a prompt with each @FolderTag rewritten to the binding
    // form the target model understands. For unsupported models the
    // rewrite degrades to the plain folder name and no URLs are sent —
    // tagging still works in the UI but only models with real reference
    // support attach the images.
    //
    // For image_urls-style image models (Nano Banana etc.) the first slot
    // is reserved for the connected primary frame, so mentions start at
    // slot 1 when connectedImageUrl is present.
    const primaryInImageUrls =
      !!connectedImageUrl && currentModel?.imageParam === 'image_urls'
    const compiled = compileMentionsForModel(
      compiledPrompt,
      mentions,
      folders,
      currentModel,
      primaryInImageUrls ? 1 : 0,
    )

    try {
      // Fan out one fal job per requested image, mirroring how video-node
      // handles batch counts. This lets us blow past fal's per-request
      // num_images cap (typically 4) — `numImages` now goes up to 12.
      const body = JSON.stringify({
        modelId,
        prompt: compiled.prompt,
        referenceImageUrl: connectedImageUrl,
        referenceGroups: compiled.refGroups.length > 0 ? compiled.refGroups : undefined,
        settings: { aspectRatio, resolution, numImages: 1 },
      })
      const count = Math.max(1, Math.min(12, numImages))
      const results = await Promise.all(
        Array.from({ length: count }, () =>
          fetch('/api/generate/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          }).then(r => r.json()),
        ),
      )

      const ok = results.filter(r => r.request_id)
      if (ok.length === 0) {
        setStatus('failed')
        setError(results[0]?.error || 'Failed to submit job')
        return
      }

      // This node tracks the first job.
      const firstEndpoint = ok[0].model || currentModel.falModel
      setFalEndpoint(firstEndpoint)
      setRequestId(ok[0].request_id)
      setStatus('in_queue')

      setNodes(ns => ns.map(n => n.id === id ? {
        ...n,
        data: { ...n.data, pendingRequestId: ok[0].request_id, pendingFalEndpoint: firstEndpoint },
      } : n))

      // Extra jobs spawn duplicate image nodes in a 3-column grid that each
      // poll their own request and fill in when done.
      if (ok.length > 1) {
        const extra = ok.slice(1)
        const self = getNodes().find(nd => nd.id === id)
        const baseX = self?.position?.x ?? 0
        const baseY = self?.position?.y ?? 0
        const w = (self?.data?.width as number) || nodeWidth || 320
        const colGap = w + 40
        const rowGap = 520
        const cols = 3
        const stamp = Date.now()
        const { shotId, outputUrl: _drop, ...restData } = (self?.data || {}) as Record<string, unknown>
        const newNodes = extra.map((res, idx) => {
          const slot = idx + 1
          const col = slot % cols
          const row = Math.floor(slot / cols)
          return {
            id: `${id}-v${stamp}-${idx}`,
            type: 'imageGen',
            position: { x: baseX + col * colGap, y: baseY + row * rowGap },
            data: {
              ...restData,
              // Duplicates carry this node's LOCAL prompt only — the
              // upstream chain is preserved by mirroring incoming edges
              // below, so the next generation merges upstream + local
              // again exactly like the original. Storing the merged
              // compiledPrompt here would double-apply the upstream
              // (upstream + (upstream + local) + …) and the text would
              // grow every cycle.
              prompt,
              pendingRequestId: res.request_id,
              pendingFalEndpoint: res.model || currentModel.falModel,
            },
          }
        })
        setNodes(ns => [...ns, ...(newNodes as any)])
        // Mirror this node's incoming connections onto the duplicates.
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

    // Stop polling immediately and locally, regardless of whether fal can
    // still cancel the job — so the UI reliably unsticks on click.
    stopRef.current = true
    if (pollingRef.current) clearTimeout(pollingRef.current)
    setStatus('cancelled')
    toast.warning('Generation cancelled', { description: currentModel.name })
    const reqId = requestId
    const cancelModel = falEndpoint || currentModel.falModel
    setRequestId(null)
    clearPending()

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
  const modelOptions = IMAGE_MODELS.map(m => ({ value: m.id, label: m.name }))
  const aspectOptions = currentModel?.aspectRatios.map(a => ({ value: a, label: a })) || []
  const resolutionOptions = currentModel?.resolutions?.map(r => ({ value: r, label: r })) || []

  return (
    <div 
      className="relative group" 
      style={{ width: nodeWidth }}
      onMouseEnter={() => setShowResizeHandle(true)}
      onMouseLeave={() => !isResizing && setShowResizeHandle(false)}
    >
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        nodeLabel={(data.label as string) || 'Image Generator'}
        assetUrl={outputUrl || undefined}
        assetType="image"
        onRename={handleRename}
        onViewFullscreen={outputUrl ? () => setLightboxOpen(true) : undefined}
      />

      <Lightbox
        open={lightboxOpen}
        url={outputUrl}
        type="image"
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
            {(data.label as string) || 'Image Generator #1'}
          </span>
        )}
      </div>

      {/* Handles - dynamic based on model inputTypes */}
      
      {/* Text input - always shown */}
      <Handle type="target" id="prompt-in" position={Position.Left} style={{ top: 80, left: -12, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={TextT} color="rgba(168,85,247,0.8)" position="left" top={80} visible />
      
      {/* Image input - only if model supports image input */}
      {currentModel?.inputTypes.includes('image') && (
        <>
          <Handle type="target" id="image-in" position={Position.Left} style={{ top: 180, left: -12, opacity: 0, width: 24, height: 24 }} />
          <HandleIcon icon={ImageIcon} color="rgba(96,165,250,0.8)" position="left" top={180} visible />
        </>
      )}
      
      {/* Image output - always shown */}
      <Handle type="source" id="image-out" position={Position.Right} style={{ top: 130, right: -12, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={ImageIcon} color="rgba(96,165,250,0.8)" position="right" top={130} visible />

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
        {/* Preview area - image displays at natural aspect ratio */}
        <div
          className="bg-[#0a0c0f] relative overflow-hidden"
          onDoubleClick={() => { if (outputUrl) setLightboxOpen(true) }}
        >
          {outputUrl ? (
            <img
              src={outputUrl}
              alt="Generated"
              loading="lazy"
              decoding="async"
              className="w-full h-auto cursor-zoom-in"
              onLoad={(e) => {
                const img = e.target as HTMLImageElement
                setImageAspect(img.naturalWidth / img.naturalHeight)
              }}
              onError={() => {
                // Image failed to load - could be stale URL
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 min-h-[220px]">
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

        {/* Prompt input. @-mention any folder (Character/Prop/Location/General)
            to attach its assets as references at generate time. */}
        <div className="px-3 pt-3 pb-2">
          <MentionTextarea
            value={prompt}
            mentions={mentions}
            onChange={(text, ms) => { setPrompt(text); setMentions(ms) }}
            folders={folders}
            placeholder="Describe the image — type @ to reference a folder…"
            disabled={isGenerating}
            className="nodrag w-full bg-transparent resize-none outline-none text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 leading-relaxed disabled:opacity-50 cursor-text"
            rows={2}
          />
        </div>

        {/* Controls - Dynamic based on model */}
        <div className="flex items-center justify-between px-3 pb-3 gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Num images counter */}
            <div className="flex items-center gap-0.5 px-1.5 h-6 rounded-md bg-white/5 text-[10px] font-mono text-muted-foreground">
              <button 
                onClick={() => setNumImages(n => Math.max(1, n - 1))}
                disabled={isGenerating || numImages <= 1}
                className="w-4 h-4 flex items-center justify-center hover:text-foreground disabled:opacity-30"
              >
                <Minus size={8} weight="bold" />
              </button>
              <span className="w-6 text-center">x{numImages}</span>
              <button
                onClick={() => setNumImages(n => Math.min(12, n + 1))}
                disabled={isGenerating || numImages >= 12}
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
            
            {/* Aspect ratio - dynamic based on model */}
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
              title="Generate image"
            >
              <Play size={10} weight="fill" />
            </button>
          )}
        </div>
      </div>

      {/* Resize handle - quarter circle arc hugging the corner */}
      <div
        className={`nodrag absolute transition-opacity duration-200 cursor-se-resize ${
          showResizeHandle || isResizing ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ bottom: -10, right: -10 }}
        onMouseDown={handleResizeStart}
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

export const ImageNode = memo(ImageNodeImpl)
ImageNode.displayName = 'ImageNode'
