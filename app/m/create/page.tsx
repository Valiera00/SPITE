'use client'

import { useEffect, useMemo, useState } from 'react'
import { FAL_MODELS, getModelById } from '@/lib/fal-models'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'
import { CircleNotch } from '@phosphor-icons/react'

type Project = { id: string; name: string }

// v1: text-to-image only — the simplest reliable mobile flow. Upscalers
// (optionalPrompt) and video/i2v models need wired inputs, so they're excluded
// here; video + references come in later phases.
const CREATE_MODELS = FAL_MODELS.filter((m) => m.category === 'image' && !m.optionalPrompt)

const SELECT_CLASS =
  'bg-[#0D0F12] border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono text-foreground focus:border-accent/50 focus:outline-none'

export default function MobileCreate() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [modelId, setModelId] = useState(CREATE_MODELS[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => {
        const list: Project[] = Array.isArray(d) ? d : []
        setProjects(list)
        setProjectId((cur) => cur || list[0]?.id || '')
      })
      .catch(() => {})
  }, [])

  const model = useMemo(() => getModelById(modelId), [modelId])
  useEffect(() => {
    setAspect(model?.defaultAspectRatio || '')
  }, [model])

  const cost = useMemo(() => estimateGenerationCost(model, { count: 1 }), [model])
  const busy = status === 'submitting' || status === 'polling'

  async function generate() {
    if (!projectId || !modelId || !prompt.trim() || busy) return
    if (cost.isKnown && cost.total > COST_CONFIRM_THRESHOLD_USD) {
      if (!window.confirm(`This will cost about ${formatUSD(cost.total)}. Generate?`)) return
    }
    setError('')
    setResultUrl(null)
    setStatus('submitting')
    try {
      const submitRes = await fetch('/api/generate/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId,
          prompt,
          settings: {
            aspectRatio: aspect || model?.defaultAspectRatio,
            resolution: model?.defaultResolution,
            numImages: 1,
          },
        }),
      })
      const submitData = await submitRes.json().catch(() => ({}))
      if (!submitRes.ok || !submitData.request_id) {
        setError(submitData.error || 'Submit failed')
        setStatus('error')
        return
      }
      setStatus('polling')
      const { request_id, model: pollModel } = submitData
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const q = new URLSearchParams({
          request_id,
          model: pollModel,
          prompt,
          projectId,
        })
        const statusRes = await fetch(`/api/generate/status?${q.toString()}`)
        const statusData = await statusRes.json().catch(() => ({}))
        if (statusData.status === 'COMPLETED') {
          setResultUrl(statusData.output?.url || null)
          setStatus('done')
          return
        }
        if (statusData.status === 'FAILED') {
          setError(statusData.error || 'Generation failed')
          setStatus('error')
          return
        }
      }
      setError('Timed out waiting for the result.')
      setStatus('error')
    } catch (err) {
      console.error('[mobile/create] error:', err)
      setError('Something went wrong.')
      setStatus('error')
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-lg font-mono tracking-wide">Create</h1>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Project</span>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={SELECT_CLASS}>
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Model</span>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)} className={SELECT_CLASS}>
          {CREATE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>

      {model && model.aspectRatios.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Aspect ratio</span>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={SELECT_CLASS}>
            {model.aspectRatios.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Prompt</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image…"
          rows={4}
          className="bg-[#0D0F12] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none resize-none"
        />
      </label>

      {resultUrl && (
        <img src={resultUrl} alt="" className="w-full rounded-xl border border-white/10" />
      )}
      {status === 'done' && resultUrl && (
        <p className="text-[11px] font-mono text-green-400/80">Saved to this project — find it in the feed.</p>
      )}
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}

      <button
        onClick={generate}
        disabled={busy || !prompt.trim() || !projectId}
        className="mt-1 rounded-xl py-3 font-mono text-sm flex items-center justify-center gap-2 bg-accent text-[#0D0F12] disabled:opacity-40 active:scale-[0.99] transition-transform"
      >
        {busy ? (
          <>
            <CircleNotch size={15} className="animate-spin" />
            {status === 'submitting' ? 'Submitting…' : 'Generating…'}
          </>
        ) : (
          <>Generate{cost.isKnown ? ` · ${formatUSD(cost.total)}` : ''}</>
        )}
      </button>
    </div>
  )
}
