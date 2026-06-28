'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CaretLeft, CircleNotch, ArrowUp } from '@phosphor-icons/react'
import { FAL_MODELS, getModelById } from '@/lib/fal-models'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'

type Asset = {
  id: string
  type: string
  r2_url: string
  prompt: string | null
  created_at: string
}

// v1: text-to-image. Video / references come in later phases.
const CREATE_MODELS = FAL_MODELS.filter((m) => m.category === 'image' && !m.optionalPrompt)

export default function MobileThread() {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const [projectName, setProjectName] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [modelId, setModelId] = useState(CREATE_MODELS[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'polling' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (p?.name) setProjectName(p.name) })
      .catch(() => {})
    fetch(`/api/assets?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setAssets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const model = useMemo(() => getModelById(modelId), [modelId])
  const cost = useMemo(() => estimateGenerationCost(model, { count: 1 }), [model])
  const busy = status === 'submitting' || status === 'polling'

  async function generate() {
    if (!prompt.trim() || busy) return
    if (cost.isKnown && cost.total > COST_CONFIRM_THRESHOLD_USD) {
      if (!window.confirm(`This will cost about ${formatUSD(cost.total)}. Generate?`)) return
    }
    const myPrompt = prompt.trim()
    setError('')
    setStatus('submitting')
    setPrompt('')
    try {
      const submitRes = await fetch('/api/generate/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId,
          prompt: myPrompt,
          settings: { aspectRatio: model?.defaultAspectRatio, resolution: model?.defaultResolution, numImages: 1 },
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
        const q = new URLSearchParams({ request_id, model: pollModel, prompt: myPrompt, projectId })
        const sd = await (await fetch(`/api/generate/status?${q.toString()}`)).json().catch(() => ({}))
        if (sd.status === 'COMPLETED') {
          const url = sd.output?.url
          if (url) {
            setAssets((prev) => [
              { id: `new-${Date.now()}`, type: sd.output?.videos ? 'video' : 'image', r2_url: url, prompt: myPrompt, created_at: new Date().toISOString() },
              ...prev,
            ])
          }
          setStatus('idle')
          return
        }
        if (sd.status === 'FAILED') {
          setError(sd.error || 'Generation failed')
          setStatus('error')
          return
        }
      }
      setError('Timed out waiting for the result.')
      setStatus('error')
    } catch (err) {
      console.error('[mobile/thread] error:', err)
      setError('Something went wrong.')
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#080A0C] text-[#F0EDE6]">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Link href="/m" className="text-muted-foreground -ml-1 p-1"><CaretLeft size={18} /></Link>
        <span className="text-sm font-mono truncate">{projectName || 'Project'}</span>
      </div>

      {/* Thread feed (newest first) */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {loading ? (
          <p className="text-sm font-mono text-muted-foreground">Loading…</p>
        ) : assets.length === 0 && !busy ? (
          <p className="text-sm font-mono text-muted-foreground/60 text-center pt-12">
            Nothing yet. Describe something below to generate.
          </p>
        ) : null}

        {busy && (
          <div className="rounded-xl border border-white/10 bg-[#0D0F12] aspect-square flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-accent">
              <CircleNotch size={22} className="animate-spin" />
              <span className="text-[11px] font-mono">{status === 'submitting' ? 'Submitting…' : 'Generating…'}</span>
            </div>
          </div>
        )}

        {assets.map((a) => (
          <div key={a.id} className="rounded-xl overflow-hidden bg-[#0D0F12] border border-white/10">
            {a.type === 'video' ? (
              <video src={a.r2_url} controls playsInline preload="metadata" className="w-full block" />
            ) : a.type === 'audio' ? (
              <audio src={a.r2_url} controls className="w-full" />
            ) : (
              <img src={a.r2_url} alt="" className="w-full block" loading="lazy" decoding="async" />
            )}
            {a.prompt && (
              <p className="px-3 py-2.5 text-[11px] font-mono text-muted-foreground line-clamp-3">{a.prompt}</p>
            )}
          </div>
        ))}
      </div>

      {/* Compose bar */}
      <div className="shrink-0 border-t border-white/10 bg-[#0D0F12] px-3 pt-3 pb-4 flex flex-col gap-2">
        {error && <p className="text-[11px] font-mono text-red-400">{error}</p>}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to create"
          rows={2}
          className="bg-[#080A0C] border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none resize-none"
        />
        <div className="flex items-center gap-2">
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="flex-1 min-w-0 bg-[#080A0C] border border-white/10 rounded-lg px-2 py-2 text-xs font-mono text-foreground focus:outline-none"
          >
            {CREATE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="text-[9px] font-mono text-muted-foreground/60 whitespace-nowrap">
            {cost.isKnown ? `~${formatUSD(cost.total)}` : ''}
          </span>
          <button
            onClick={generate}
            disabled={busy || !prompt.trim()}
            className="shrink-0 w-10 h-10 rounded-full bg-accent text-[#0D0F12] flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          >
            {busy ? <CircleNotch size={16} className="animate-spin" /> : <ArrowUp size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </div>
  )
}
