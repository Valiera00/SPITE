'use client'

import { useEffect, useMemo, useState } from 'react'
import { useNodes, useReactFlow } from '@xyflow/react'
import {
  X,
  CheckCircle,
  XCircle,
  CircleNotch,
  ImageSquare,
  FilmSlate,
} from '@phosphor-icons/react'

type Job = {
  id: string
  label: string
  status: 'idle' | 'submitting' | 'in_queue' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  error?: string
  outputUrl?: string
  submittedAt?: number
  modelId?: string
  mediaType: 'image' | 'video'
  position: { x: number; y: number }
  width?: number
  height?: number
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export function JobsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useNodes()
  const { setCenter } = useReactFlow()
  // Tick every 5s while the panel is open so relative times stay fresh
  // without us needing to wire each row into a per-row timer.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const interval = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(interval)
  }, [open])

  const jobs: Job[] = useMemo(() => {
    return nodes
      .filter(n => n.type === 'imageGen' || n.type === 'videoGen')
      .map(n => {
        const data = n.data as Record<string, any>
        const rawStatus = (data.status as string) || (data.outputUrl ? 'completed' : 'idle')
        return {
          id: n.id,
          label: data.label || (n.type === 'imageGen' ? 'Image' : 'Video'),
          status: rawStatus as Job['status'],
          error: data.error as string | undefined,
          outputUrl: data.outputUrl as string | undefined,
          submittedAt: data.submittedAt as number | undefined,
          modelId: data.modelId as string | undefined,
          mediaType: (n.type === 'imageGen' ? 'image' : 'video') as 'image' | 'video',
          position: n.position,
          width: (n as any).width || undefined,
          height: (n as any).height || undefined,
        }
      })
      // Show anything that's been submitted at least once OR has an output.
      // Nodes the user dragged in but never ran stay off the list.
      .filter(j => j.status !== 'idle' || j.outputUrl)
      .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
  }, [nodes])

  const activeCount = jobs.filter(
    j => j.status === 'submitting' || j.status === 'in_queue' || j.status === 'in_progress',
  ).length

  const focusNode = (job: Job) => {
    const x = job.position.x + (job.width || 360) / 2
    const y = job.position.y + (job.height || 240) / 2
    setCenter(x, y, { duration: 500, zoom: 1 })
  }

  if (!open) return null

  return (
    <div className="fixed right-0 top-12 bottom-0 w-80 glass border-l border-white/[0.06] z-30 flex flex-col"
      style={{ backdropFilter: 'blur(20px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/[0.06] shrink-0">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-foreground/80">Jobs</h3>
          <span className="text-[10px] font-mono text-muted-foreground/50">
            {jobs.length}
            {activeCount > 0 && <span className="text-accent/80"> · {activeCount} active</span>}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-6 h-6 rounded-md glass-hover text-muted-foreground hover:text-foreground transition-colors"
          title="Close jobs panel"
        >
          <X size={12} weight="thin" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[10px] font-mono text-muted-foreground/40 leading-relaxed">
              No jobs yet. Submit a generation and it'll show up here.
            </p>
          </div>
        ) : (
          jobs.map(job => (
            <JobRow key={job.id} job={job} onClick={() => focusNode(job)} />
          ))
        )}
      </div>
    </div>
  )
}

function JobRow({ job, onClick }: { job: Job; onClick: () => void }) {
  const age = job.submittedAt ? formatAge(Date.now() - job.submittedAt) : '—'
  const isActive =
    job.status === 'submitting' ||
    job.status === 'in_queue' ||
    job.status === 'in_progress'

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors text-left"
      title="Click to focus this node on the canvas"
    >
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-md bg-zinc-900/80 flex-shrink-0 overflow-hidden flex items-center justify-center border border-white/5">
        {job.outputUrl && (job.status === 'completed' || job.status === 'failed') ? (
          job.mediaType === 'image' ? (
            <img src={job.outputUrl} className="w-full h-full object-cover" alt="" draggable={false} />
          ) : (
            <video src={job.outputUrl} muted playsInline className="w-full h-full object-cover" />
          )
        ) : job.mediaType === 'image' ? (
          <ImageSquare size={16} weight="thin" className="text-muted-foreground/40" />
        ) : (
          <FilmSlate size={16} weight="thin" className="text-muted-foreground/40" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-mono text-foreground/90 truncate leading-tight">
          {job.label}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-mono text-muted-foreground/55 tracking-wide">
            {age}
          </span>
          {job.modelId && (
            <span className="text-[9px] font-mono text-muted-foreground/35 truncate">
              {job.modelId}
            </span>
          )}
        </div>
        {job.status === 'failed' && job.error && (
          <div className="text-[9px] font-mono text-red-400/80 mt-1 leading-snug">
            {job.error}
          </div>
        )}
      </div>

      {/* Status icon */}
      <div className="flex-shrink-0 mt-0.5">
        {job.status === 'completed' && (
          <CheckCircle size={14} weight="fill" className="text-green-400" />
        )}
        {job.status === 'failed' && (
          <XCircle size={14} weight="fill" className="text-red-400" />
        )}
        {job.status === 'cancelled' && (
          <XCircle size={14} weight="thin" className="text-muted-foreground/40" />
        )}
        {isActive && (
          <CircleNotch size={14} weight="thin" className="text-accent animate-spin" />
        )}
      </div>
    </button>
  )
}
