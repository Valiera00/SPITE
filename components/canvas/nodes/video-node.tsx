'use client'

import { Position, NodeProps, Handle, useReactFlow, useUpdateNodeInternals } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { Play, CaretDown, SpeakerHigh, SpeakerSlash, TextT, Image as ImageIcon, FilmStrip, CircleNotch, X, Check, ArrowsClockwise, Minus, Plus } from '@phosphor-icons/react'
import { memo, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { NodeActionToolbar } from './node-toolbar'
import { ShotSelector, type ShotOption } from './shot-selector'
import { useSceneShots } from './use-scene-shots'
import { Lightbox } from '../lightbox'
import { MentionTextarea, type Mention } from '../mention-textarea'
import { useProjectFolders } from '@/hooks/use-project-folders'
import { labelFromPrompt, DEFAULT_VIDEO_LABEL } from '@/lib/auto-name'
import { getVideoModels, getModelById, buildModelInput, type ModelConfig } from '@/lib/fal-models'
import { compileMentionsForModel } from '@/lib/mention-prompt'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'
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
    in_progress: { label: progress ? `${Math.round(progress * 100)}%` : 'Generating...', color: 'text-accent' },
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

function VideoNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  // Route segment is [id], so the param is `id` (not `projectId`).
  const projectId = params.id as string
  const [prompt, setPrompt] = useState((data.prompt as string) || '')
  // Upscaler mode (only meaningful when modelId is 'topaz-video-upscale').
  // 'standard' hits the plug-n-play endpoint; 'creative' hits the
  // prompt-aware variant. Persists in node data so it survives reload.
  const [upscaleMode, setUpscaleMode] = useState<'standard' | 'creative'>(
    (data.upscaleMode as 'standard' | 'creative') || 'standard',
  )
  const [mentions, setMentions] = useState<Mention[]>((data.mentions as Mention[]) || [])
  const { folders } = useProjectFolders(projectId)
  const [modelId, setModelId] = useState((data.modelId as string) || 'seedance-1.5')
  const [duration, setDuration] = useState((data.duration as string) || '')
  const [aspectRatio, setAspectRatio] = useState((data.aspectRatio as string) || '')
  const [resolution, setResolution] = useState((data.resolution as string) || '')
  const [enableAudio, setEnableAudio] = useState((data.enableAudio as boolean) || false)
  const [enableLoop, setEnableLoop] = useState((data.enableLoop as boolean) || false)
  // Kling 2.6 voice IDs — up to 2, comma-separated in the input box.
  // User pastes IDs they generated from fal's create-voice endpoint;
  // SPITE forwards them as voice_ids on submit. They reference voices
  // in the prompt with <<<voice_1>>> / <<<voice_2>>>.
  const [voiceIds, setVoiceIds] = useState((data.voiceIds as string) || '')
  // Video models are expensive enough (Seedance ≈ $4.50 per 5-sec clip,
  // Kling Pro variants higher) that we deliberately DON'T persist the
  // counter across reloads. Every session starts at 1, and bumping it
  // up has to be a conscious action — "I want 3 Seedance shots" should
  // require typing it in, not get inherited from a forgotten setting.
  // Image counters persist (cheaper, often-used in batches of 6).
  const [numVideos, setNumVideos] = useState(1)
  
  const [status, setStatus] = useState<GenerationStatus>('idle')
  const [progress, setProgress] = useState<number | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>((data.outputUrl as string) || null)
  const [requestId, setRequestId] = useState<string | null>(null)
  // Timestamp of the most recent submission. Powers the relative-age
  // display in the right-side jobs panel.
  const [submittedAt, setSubmittedAt] = useState<number | undefined>(
    (data.submittedAt as number) || undefined,
  )
  // The exact fal queue path to poll, as told to us by the submit response.
  const [falEndpoint, setFalEndpoint] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  // Set true to immediately stop polling (cancel / unmount).
  const stopRef = useRef(false)
  const { setNodes, getEdges, getNodes } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  
  // Check connection states fresh on each render
  let hasConnectedPrompts = false
  let hasConnectedFirstFrame = false
  let hasConnectedReferences = false
  let hasConnectedVideo = false
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
    hasConnectedVideo = allIncomingEdges.some(e =>
      e.targetHandle === 'video-in' || e.sourceHandle === 'video-out'
    )
  } catch { /* ignore */ }

  // Get current model config
  const currentModel = useMemo(() => getModelById(modelId), [modelId])

  // When the model changes, the conditional handles (image-in, reference-in,
  // video-in, end-frame-in) appear or disappear. React Flow caches handle
  // positions on first measurement — without a manual nudge those caches
  // stay stale until something else re-measures (e.g., a page reload).
  // That's why edges to handles that ONLY exist for the new model were
  // sometimes added to state but not drawn: React Flow had no position
  // for the new handle yet. Tell it to re-measure whenever the handle set
  // shape changes.
  useEffect(() => {
    updateNodeInternals(id)
  }, [
    id,
    updateNodeInternals,
    currentModel?.id,
    currentModel?.inputTypes,
    currentModel?.referenceParam,
    currentModel?.category,
  ])

  // Kling v3 references ride the image-to-video endpoint, which requires a
  // first frame. Block generation (with a clear message) when refs are
  // connected but no first frame, so the user gets a helpful error not a
  // confusing fal validation failure.
  const refsRequireFirstFrame = !!currentModel?.referenceParam && currentModel.referenceParam === 'elements' && !currentModel.referenceModel
  const blockedNoFirstFrame = refsRequireFirstFrame && hasConnectedReferences && !hasConnectedFirstFrame

  // Reset settings when the USER picks a new model. Skip the initial mount
  // so saved settings on a reloaded or duplicated node aren't immediately
  // clobbered by model defaults.
  const prevModelIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentModel) return
    if (prevModelIdRef.current === null) {
      prevModelIdRef.current = currentModel.id
      return
    }
    if (prevModelIdRef.current !== currentModel.id) {
      setAspectRatio(currentModel.defaultAspectRatio)
      setDuration(currentModel.defaultDuration || '')
      setResolution(currentModel.defaultResolution || '')
      setEnableAudio(false)
      setEnableLoop(false)
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
      data: { ...n.data, prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl, mentions, upscaleMode, voiceIds, status, error, submittedAt }
    } : n))
  }, [prompt, modelId, duration, aspectRatio, resolution, enableAudio, enableLoop, numVideos, outputUrl, mentions, upscaleMode, voiceIds, status, error, submittedAt, id, setNodes])

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

  // Resume polling on mount when this node has an in-flight job recorded —
  // either because it was spawned for a batch generation, or because the
  // user refreshed the page mid-generation. We do NOT clear the data
  // here; the marker stays until the generation actually resolves, so
  // another refresh resumes too.
  useEffect(() => {
    const pending = data.pendingRequestId as string | undefined
    if (pending && !outputUrl && !requestId) {
      setFalEndpoint((data.pendingFalEndpoint as string) || null)
      setRequestId(pending)
      setStatus('in_queue')
      // Restore the start-of-generation timestamp (or assume now if the
      // page was refreshed and we don't have it stored). Used by the
      // 10-minute soft timeout below.
      const startedAt = (data.pendingStartedAt as number | undefined) ?? Date.now()
      startTimeRef.current = startedAt
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clear the persisted in-flight job marker when the generation resolves.
  const clearPending = useCallback(() => {
    setNodes(ns => ns.map(n => n.id === id ? {
      ...n,
      data: { ...n.data, pendingRequestId: undefined, pendingFalEndpoint: undefined, pendingStartedAt: undefined },
    } : n))
  }, [id, setNodes])

  // 10-minute soft timeout. Stops polling and marks the node failed, but
  // does NOT clear pendingRequestId — the user can click "Re-check
  // result" to poll again in case fal completed after the timeout
  // window. Resets when the user clicks re-check or triggers a new
  // generation.
  const TIMEOUT_MS = 10 * 60 * 1000
  const startTimeRef = useRef<number | null>(null)
  // Bumped to force the polling effect to restart on user-initiated re-check.
  const [resumeToken, setResumeToken] = useState(0)

  // Poll for status
  const pollStatus = useCallback(async (reqId: string, falModelId: string) => {
    if (stopRef.current) return true
    // Soft timeout check — bail BEFORE the next round-trip so we don't
    // continue hammering fal indefinitely. The request_id stays in node
    // data so the user can manually re-check.
    if (startTimeRef.current && Date.now() - startTimeRef.current > TIMEOUT_MS) {
      setStatus('failed')
      setError("Generation took over 10 min — fal might still finish. Use 'Re-check result' to look again, or 'Cancel' to give up.")
      return true
    }
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
      console.error('Poll error:', err)
      return false
    }
  }, [clearPending])

  // Start polling when we have a request_id. resumeToken is included as
  // a dep so a user-initiated re-check (handleRecheck below) restarts the
  // polling loop even though requestId itself didn't change.
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
  }, [requestId, currentModel, falEndpoint, pollStatus, resumeToken])

  // User-triggered re-check of a request that timed out (or that the
  // user wants to poll again for any reason). Fires a SINGLE direct
  // status call against fal so the user sees fal's actual answer
  // immediately — without waiting for the 4-second polling cadence.
  // Toast-reports the outcome so it's obvious whether fal genuinely
  // still has the job in queue, finished it, or errored. If the job
  // is still pending, resumeToken is bumped to restart the background
  // polling loop for another 10-minute window.
  const handleRecheck = async () => {
    if (!requestId || !currentModel) return
    const pollModel = falEndpoint || currentModel.falModel
    const toastId = `recheck-${id}`

    startTimeRef.current = Date.now()
    setError(null)
    setStatus('in_queue')

    toast.loading('Checking fal for this job…', { id: toastId })

    try {
      const response = await fetch(
        `/api/generate/status?request_id=${requestId}&model=${encodeURIComponent(pollModel)}&projectId=${projectId}&prompt=${encodeURIComponent(prompt)}`,
      )
      const result = await response.json()

      if (result.error) {
        setStatus('failed')
        setError(result.error)
        clearPending()
        toast.error(`fal: ${result.error}`, { id: toastId })
        return
      }

      if (result.status === 'COMPLETED') {
        const videoUrl =
          result.output?.url ||
          result.output?.videos?.[0] ||
          result.result?.video?.url ||
          result.result?.video_url
        if (videoUrl) setOutputUrl(videoUrl)
        setStatus('completed')
        setProgress(undefined)
        clearPending()
        toast.success('Result is ready — saved to your library.', { id: toastId })
        return
      }

      if (result.status === 'FAILED') {
        setStatus('failed')
        setError(result.error || 'Generation failed')
        clearPending()
        toast.error(`fal: ${result.error || 'Generation failed'}`, { id: toastId })
        return
      }

      // Still IN_QUEUE or IN_PROGRESS — keep polling.
      if (result.status === 'IN_PROGRESS') {
        setStatus('in_progress')
        if (result.progress !== undefined) setProgress(result.progress)
        const pct = typeof result.progress === 'number' ? ` (${Math.round(result.progress * 100)}%)` : ''
        toast.info(`fal is generating this now${pct}. Polling resumed.`, { id: toastId })
      } else {
        setStatus('in_queue')
        const posLabel = typeof result.position === 'number' ? ` (queue position ${result.position})` : ''
        toast.info(`Still in fal's queue${posLabel}. Polling resumed for 10 more minutes.`, { id: toastId })
      }
      setResumeToken(t => t + 1)
    } catch (err) {
      console.error('[recheck] error:', err)
      toast.error("Couldn't reach fal — check connection and try again.", { id: toastId })
    }
  }

  const handleGenerate = async () => {
    // Compile prompts from connected nodes and this node's prompt
    let compiledPrompt = ''
    let connectedImageUrl: string | null = null
    let connectedEndImageUrl: string | null = null
    let connectedReferenceUrls: string[] = []
    let connectedVideoUrl: string | null = null
    let connectedAudioUrl: string | null = null

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

      // Connected audio (Kling 2.6 only). Matches audio-in handle or
      // any edge whose source is the audio-out handle on an audio
      // reference node. Server-side will auto-create voice_id via fal.
      const incomingAudioEdges = edges.filter(
        edge => edge.target === id && (
          edge.targetHandle === 'audio-in' ||
          edge.sourceHandle === 'audio-out'
        )
      )
      if (incomingAudioEdges.length > 0) {
        const audioEdge = incomingAudioEdges[0]
        const sourceNode = nodes.find(n => n.id === audioEdge.source)
        const sourceAudioUrl = (sourceNode?.data?.thumbnail || sourceNode?.data?.outputUrl) as string | undefined
        if (sourceAudioUrl) {
          connectedAudioUrl = sourceAudioUrl
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
      console.error('Error compiling prompts:', error)
      compiledPrompt = prompt.trim()
    }

    // Upscalers (Topaz Standard mode) don't take a prompt — a connected
    // video on video-in is the readiness signal. Don't block submission
    // here for those; let the server handle whatever's missing.
    const isUpscalerStandard =
      modelId === 'topaz-video-upscale' && upscaleMode === 'standard'
    if (!compiledPrompt && !isUpscalerStandard) {
      setError('Please enter a prompt')
      return
    }

    if (!currentModel) {
      setError('Please select a model')
      return
    }

    setSubmittedAt(Date.now())
    setStatus('submitting')
    setError(null)
    setOutputUrl(null)
    setProgress(undefined)

    // Folder-mention refs append to whatever the user wired into the
    // pink reference-in handle. Local mentions are authoritative; @tags
    // appearing only in the compiled prompt (e.g. forwarded by a connected
    // prompt-node) fall back to "use every asset in the matched folder".
    //
    // compileMentionsForModel rewrites the prompt so each @FolderTag is
    // replaced with the citation the target model understands and groups
    // every mention's URLs so the server can build per-subject elements
    // for element-based models (Kling v3). Wired pink-handle refs occupy
    // the leading element/slot positions; folder mentions start after.
    const compiled = compileMentionsForModel(
      compiledPrompt,
      mentions,
      folders,
      currentModel,
      connectedReferenceUrls.length,
    )
    const wiredGroups = connectedReferenceUrls.map((url) => ({ urls: [url] }))
    const referenceGroups = [...wiredGroups, ...compiled.refGroups]

    try {
      // Topaz upscaler never takes a prompt — its API uses a `model`
      // parameter (Proteus vs Starlight HQ) to pick the variant. Force
      // empty so any stale prompt in node state doesn't leak through.
      const submitPrompt = modelId === 'topaz-video-upscale' ? '' : compiled.prompt

      // Send RAW settings; the server builds the model-specific payload.
      const body = JSON.stringify({
        modelId,
        prompt: submitPrompt,
        referenceImageUrl: connectedImageUrl,
        endImageUrl: connectedEndImageUrl,
        referenceGroups: referenceGroups.length ? referenceGroups : undefined,
        settings: {
          aspectRatio,
          duration,
          resolution,
          enableAudio,
          enableLoop,
          videoUrl: connectedVideoUrl || undefined,
          // Connected audio asset URL (Kling 2.6 only). Server creates
          // and caches a fal voice_id for this audio, appends it to the
          // voice_ids array, runs the generation.
          audioUrl: connectedAudioUrl || undefined,
          // Upscaler mode picks the Topaz model variant server-side.
          upscaleMode,
          // Kling 2.6 voice IDs — parsed server-side into array.
          voiceIds: voiceIds.trim() || undefined,
        },
      })

      // Each video is a separate fal job. Stagger the parallel POSTs by
      // ~200ms each so Vercel's edge / fal's per-key limiter doesn't
      // reject 1-2 of N as anomalous traffic (the image-node hit this
      // with a 403 on one of three simultaneous submits). Requests
      // still complete in parallel; only the start times are spread.
      const count = Math.max(1, Math.min(12, numVideos))
      const submitOnce = async (i: number) => {
        if (i > 0) await new Promise<void>(r => setTimeout(r, i * 200))
        try {
          const res = await fetch('/api/generate/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
          const json = await res.json().catch(() => ({}))
          return { ...json, _httpStatus: res.status }
        } catch {
          return { _httpStatus: 0 }
        }
      }
      const results = await Promise.all(
        Array.from({ length: count }, (_, i) => submitOnce(i)),
      )
      const ok = results.filter(r => r.request_id)
      const failedCount = count - ok.length
      if (ok.length === 0) {
        const firstFail = results[0]
        const status = firstFail?._httpStatus
        const reason =
          status === 403 ? 'rejected by Vercel edge (rate limit on parallel requests)'
          : status === 503 ? 'generation disabled (GENERATION_DISABLED env var)'
          : firstFail?.error || `HTTP ${status || 'error'}`
        setStatus('failed')
        setError(`Failed to submit job — ${reason}`)
        return
      }
      if (failedCount > 0) {
        toast.warning(
          `Only ${ok.length} of ${count} submissions accepted — ${failedCount} rejected (likely rate-limit). You were billed for ${ok.length}.`,
          { duration: 8000 },
        )
      }

      // This node tracks the first job.
      const firstEndpoint = ok[0].model || currentModel.falModel
      const startedAt = Date.now()
      setFalEndpoint(firstEndpoint)
      setRequestId(ok[0].request_id)
      setStatus('in_queue')
      startTimeRef.current = startedAt

      // Persist the in-flight job onto the node so polling can resume
      // after a page refresh. Cleared when the generation resolves.
      setNodes(ns => ns.map(n => n.id === id ? {
        ...n,
        data: {
          ...n.data,
          pendingRequestId: ok[0].request_id,
          pendingFalEndpoint: firstEndpoint,
          pendingStartedAt: startedAt,
        },
      } : n))

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
              // Local prompt only — incoming edges are mirrored below so
              // the upstream chain still feeds in at generate time.
              // Storing the merged compiledPrompt here would double-apply
              // the upstream every cycle and the text would grow.
              prompt,
              pendingRequestId: res.request_id,
              pendingFalEndpoint: res.model || currentModel.falModel,
              pendingStartedAt: stamp,
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

  // Cost-aware generate wrapper. Estimates the fal charge for the
  // current model × batch count × duration, surfaces it in the
  // button tooltip, and gates handleGenerate behind a blocking
  // window.confirm() when the estimate crosses the safety threshold.
  // Native confirm is intentional: the goal is "you cannot click
  // through without seeing the dollar amount", not aesthetics.
  const costEstimate = useMemo(
    () => estimateGenerationCost(currentModel, {
      count: numVideos,
      durationSeconds: duration ? parseInt(duration) : undefined,
    }),
    [currentModel, numVideos, duration],
  )
  const generateTooltip = useMemo(() => {
    if (!currentModel) return 'Generate video'
    if (blockedNoFirstFrame) {
      return `${currentModel?.name} needs a first frame when references are connected — wire an image into the blue First frame handle.`
    }
    const label = `Generate ${numVideos} video${numVideos === 1 ? '' : 's'}`
    if (!costEstimate.isKnown) return `${label}\n(price not estimated for this model)`
    return `${label}\nEstimated cost: ~${formatUSD(costEstimate.total)} (${formatUSD(costEstimate.perUnit)} each).\nReal cost depends on resolution, duration and model load.`
  }, [currentModel, numVideos, costEstimate, blockedNoFirstFrame])
  const requestGenerate = () => {
    if (costEstimate.isKnown && costEstimate.total >= COST_CONFIRM_THRESHOLD_USD) {
      const msg =
        `You're about to submit ${numVideos} ${currentModel?.name || 'video'} generation${numVideos === 1 ? '' : 's'} ` +
        `to fal.ai.\n\n` +
        `Estimated cost: ~${formatUSD(costEstimate.total)} (${formatUSD(costEstimate.perUnit)} each).\n` +
        `Real cost depends on resolution, duration and model load.\n\n` +
        `Press OK to confirm and spend this, or Cancel to back out.`
      if (!window.confirm(msg)) return
    }
    handleGenerate()
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
    clearPending()

    try {
      await fetch('/api/generate/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: reqId, model: cancelModel }),
      })
    } catch (err) {
      console.error('Cancel error:', err)
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
      
      {/* Text input - always shown.
          NOTE on zIndex: handles are positioned absolutely as siblings of
          the card, but the card comes AFTER them in DOM order so by default
          stacks on top. That made drops at y=250 (reference-in) land on the
          prompt textarea instead of the handle and silently fail. zIndex:5
          puts every Handle above the card so React Flow's drop detection
          actually finds them. */}
      <Handle type="target" id="prompt-in" position={Position.Left} style={{ top: 80, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
      <HandleIcon icon={TextT} color="rgba(107,143,168,0.8)" position="left" top={80} visible />

      {/* First frame (blue) - only if model supports image input */}
      {currentModel?.inputTypes.includes('image') && (
        <>
          <Handle type="target" id="image-in" title="First frame" position={Position.Left} style={{ top: 150, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
          <HandleIcon icon={ImageIcon} color="rgba(96,165,250,0.8)" position="left" top={150} visible />
        </>
      )}

      {/* End frame (amber) - video models that support a last frame */}
      {currentModel?.category === 'video' && !currentModel.id.startsWith('minimax') && (
        <>
          <Handle type="target" id="end-frame-in" title="End frame" position={Position.Left} style={{ top: 200, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
          <HandleIcon icon={ImageIcon} color="rgba(251,191,36,0.9)" position="left" top={200} visible />
        </>
      )}

      {/* Reference images (pink) - models that support subject/style refs.
          Accepts multiple image connections. */}
      {currentModel?.referenceParam && (
        <>
          <Handle type="target" id="reference-in" title="Reference image(s)" position={Position.Left} style={{ top: 250, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
          <HandleIcon icon={ImageIcon} color="rgba(236,72,153,0.9)" position="left" top={250} visible />
        </>
      )}

      {/* Audio voice (amber) — Kling 2.6 only. Wire an audio reference
          here and SPITE auto-creates a voice_id via fal's create-voice
          endpoint, caches it, and uses it without the user having to
          paste anything. */}
      {currentModel?.id === 'kling-2.6' && (
        <>
          <Handle type="target" id="audio-in" title="Voice reference audio" position={Position.Left} style={{ top: 370, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
          <HandleIcon icon={SpeakerHigh} color="rgba(251,191,36,0.9)" position="left" top={370} visible />
        </>
      )}

      {/* Video input (green) - only if model supports video-to-video */}
      {currentModel?.inputTypes.includes('video') && (
        <>
          <Handle type="target" id="video-in" title="Source video" position={Position.Left} style={{ top: 310, left: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
          <HandleIcon icon={FilmStrip} color="rgba(74,222,128,0.8)" position="left" top={310} visible />
        </>
      )}

      {/* Video output - always shown */}
      <Handle type="source" id="video-out" position={Position.Right} style={{ top: 150, right: -12, opacity: 0, width: 24, height: 24, zIndex: 5 }} />
      <HandleIcon icon={FilmStrip} color="rgba(74,222,128,0.8)" position="right" top={150} visible />

      {/* Card content */}
      <div
        className="flex flex-col rounded-xl overflow-hidden transition-all duration-200"
        style={{
          background: '#0D0F12',
          border: isTaggedToShot 
            ? '1.5px solid rgba(251,191,36,0.7)' 
            : selected 
              ? '1.5px solid rgba(107,143,168,0.85)' 
              : '1.5px solid rgba(107,143,168,0.25)',
          boxShadow: isTaggedToShot
            ? '0 0 0 1px rgba(251,191,36,0.2), 0 0 20px rgba(251,191,36,0.25), 0 0 40px rgba(251,191,36,0.1)'
            : selected 
              ? '0 0 0 1px rgba(107,143,168,0.2), 0 0 24px rgba(107,143,168,0.15)' 
              : 'none',
        }}
      >
        {/* Preview area */}
        <div
          className="min-h-[220px] bg-[#0a0c0f] flex items-center justify-center relative"
        >
          {outputUrl ? (
            <video
              src={outputUrl}
              controls
              loop={enableLoop}
              muted={!enableAudio}
              preload="metadata"
              controlsList="nofullscreen"
              onDoubleClick={(e) => {
                // The browser's built-in video controls trigger native
                // fullscreen on dblclick; suppress it so only our lightbox opens.
                e.preventDefault()
                e.stopPropagation()
                setLightboxOpen(true)
              }}
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

        {/* Prompt input. @-mention any folder (Character/Prop/Location/General)
            to attach its assets as references at generate time. Hidden for
            the Topaz upscaler entirely — Topaz's API takes a model param
            ('Proteus' for Standard, 'Starlight HQ' for Creative), not a
            prompt, so showing the field would be misleading in either mode. */}
        {modelId !== 'topaz-video-upscale' && (
          <div className="px-3 pt-3 pb-2">
            <MentionTextarea
              value={prompt}
              mentions={mentions}
              onChange={(text, ms) => { setPrompt(text); setMentions(ms) }}
              folders={folders}
              placeholder="Describe the video — type @ to reference a folder…"
              disabled={isGenerating}
              className="nodrag w-full bg-transparent resize-none outline-none text-[12px] text-foreground/90 placeholder:text-muted-foreground/40 leading-relaxed disabled:opacity-50 cursor-text"
              rows={2}
            />
          </div>
        )}

        {/* Kling 2.6 voice ID slots. Only shown for kling-2.6 since it's
            the only model on our list that supports this. Max 2 voices
            per fal docs; user references them in the prompt with
            <<<voice_1>>> and <<<voice_2>>>. Comma-separated input;
            server splits and sends as voice_ids array. */}
        {modelId === 'kling-2.6' && (
          <div className="px-3 pb-2">
            <input
              type="text"
              value={voiceIds}
              onChange={e => setVoiceIds(e.target.value)}
              placeholder="Voice IDs — paste from fal create-voice (max 2, comma-separated)"
              disabled={isGenerating}
              className="nodrag w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1.5 text-[11px] font-mono text-foreground/90 placeholder:text-muted-foreground/40 outline-none focus:border-accent/40 disabled:opacity-50"
            />
            <p className="text-[9px] font-mono text-muted-foreground/40 mt-1 leading-snug">
              Reference in prompt as {`<<<voice_1>>>`} / {`<<<voice_2>>>`}. Get IDs from fal&apos;s create-voice endpoint.
            </p>
          </div>
        )}

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
              <span className="w-6 text-center">x{numVideos}</span>
              <button
                onClick={() => setNumVideos(n => Math.min(12, n + 1))}
                disabled={isGenerating || numVideos >= 12}
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

            {/* Topaz mode toggle — only when the upscaler is selected. */}
            {modelId === 'topaz-video-upscale' && (
              <ControlSelect
                value={upscaleMode === 'creative' ? 'Creative' : 'Standard'}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'creative', label: 'Creative' },
                ]}
                onChange={(v) => setUpscaleMode(v as 'standard' | 'creative')}
                disabled={isGenerating}
              />
            )}

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
          
          {/* Generate / Cancel / Re-check button.
              When a job has timed out (status='failed' but we still have
              the request_id from fal), show a "re-check" button so the
              user can poll once more in case fal completed late — fal
              keeps results around for ~24h, so a slow job isn't lost. */}
          {isGenerating ? (
            <button
              onClick={handleCancel}
              className="w-6 h-6 rounded-full bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition-colors"
              title="Cancel generation"
            >
              <X size={10} weight="bold" />
            </button>
          ) : status === 'failed' && requestId ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleRecheck}
                className="px-2 h-6 rounded-full bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white flex items-center justify-center transition-colors text-[9px] font-mono"
                title="Try fetching the result from fal again — generations that took longer than the timeout window may still be available."
              >
                Re-check
              </button>
              <button
                onClick={handleCancel}
                className="w-6 h-6 rounded-full bg-white/5 hover:bg-red-500 text-muted-foreground hover:text-white flex items-center justify-center transition-colors"
                title="Give up and clear this request from the node"
              >
                <X size={10} weight="bold" />
              </button>
            </div>
          ) : (
            <button
              onClick={requestGenerate}
              // Upscalers are video-in, not prompt-in — the "needs a prompt or
              // a connected prompt node" check would always reject them. A
              // connected video on video-in is the upscaler's equivalent
              // readiness signal.
              disabled={
                isGenerating ||
                blockedNoFirstFrame ||
                (modelId === 'topaz-video-upscale'
                  ? !hasConnectedVideo
                  : !prompt.trim() && !hasConnectedPrompts)
              }
              className="w-6 h-6 rounded-full bg-accent/20 hover:bg-accent text-accent hover:text-accent-foreground flex items-center justify-center transition-colors accent-glow disabled:opacity-50 disabled:cursor-not-allowed"
              title={generateTooltip}
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

export const VideoNode = memo(VideoNodeImpl)
VideoNode.displayName = 'VideoNode'
