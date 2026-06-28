'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CaretLeft, CircleNotch, ArrowUp, ImageSquare, X, DownloadSimple } from '@phosphor-icons/react'
import { FAL_MODELS, getModelById } from '@/lib/fal-models'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'

type Asset = {
  id: string
  type: string
  model: string | null
  r2_url: string
  prompt: string | null
  created_at: string
}

type Ref = { id: string; previewUrl: string; proxyUrl: string | null; uploading: boolean }

const CREATE_MODELS = FAL_MODELS.filter((m) => m.category === 'image' && !m.optionalPrompt)

function cleanModel(m: string | null): string {
  if (!m) return ''
  const known = FAL_MODELS.find((x) => x.id === m || x.falModel === m || x.editModel === m)
  if (known) return known.name
  return m.replace(/^fal-ai\//, '').replace(/^openai\//, '').split('/')[0]
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function MobileThread() {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const fileRef = useRef<HTMLInputElement>(null)

  const [projectName, setProjectName] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [modelId, setModelId] = useState(CREATE_MODELS[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<Ref[]>([])
  const [status, setStatus] = useState<'idle' | 'submitting' | 'polling' | 'error'>('idle')
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)

  const loadBalance = () =>
    fetch('/api/fal/balance')
      .then((r) => r.json())
      .then((d) => setBalance(d?.available && typeof d.balance === 'number' ? d.balance : null))
      .catch(() => {})

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}`).then((r) => (r.ok ? r.json() : null)).then((p) => { if (p?.name) setProjectName(p.name) }).catch(() => {})
    fetch(`/api/assets?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setAssets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
    loadBalance()
  }, [projectId])

  const model = useMemo(() => getModelById(modelId), [modelId])
  const cost = useMemo(() => estimateGenerationCost(model, { count: 1 }), [model])
  const busy = status === 'submitting' || status === 'polling'
  const uploadingRef = refs.some((r) => r.uploading)

  function onPickRef(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const id = `ref-${Date.now()}`
    const previewUrl = URL.createObjectURL(file)
    setRefs((prev) => [...prev, { id, previewUrl, proxyUrl: null, uploading: true }])
    ;(async () => {
      try {
        const presignRes = await fetch('/api/r2-presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        })
        const { presignedUrl, proxyUrl } = await presignRes.json()
        const putRes = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!putRes.ok) throw new Error('upload failed')
        setRefs((prev) => prev.map((r) => (r.id === id ? { ...r, proxyUrl, uploading: false } : r)))
      } catch {
        setRefs((prev) => prev.filter((r) => r.id !== id))
        setError('Reference upload failed.')
      }
    })()
  }

  function removeRef(id: string) {
    setRefs((prev) => prev.filter((r) => r.id !== id))
  }

  async function generate() {
    if (!prompt.trim() || busy || uploadingRef) return
    if (cost.isKnown && cost.total > COST_CONFIRM_THRESHOLD_USD) {
      if (!window.confirm(`This will cost about ${formatUSD(cost.total)}. Generate?`)) return
    }
    const myPrompt = prompt.trim()
    const refUrls = refs.map((r) => r.proxyUrl).filter((u): u is string => !!u)
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
          referenceImageUrl: refUrls[0],
          referenceGroups: refUrls.length > 1 ? refUrls.slice(1).map((u) => ({ urls: [u] })) : undefined,
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
              { id: `new-${Date.now()}`, type: sd.output?.videos ? 'video' : 'image', model: model?.name || null, r2_url: url, prompt: myPrompt, created_at: new Date().toISOString() },
              ...prev,
            ])
          }
          setRefs([])
          setStatus('idle')
          loadBalance()
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
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (files) Array.from(files).forEach((f) => onPickRef(f))
          // reset so re-picking the same file(s) fires onChange again
          e.target.value = ''
        }}
      />

      {/* Header */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-white/10"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <Link href="/m" className="text-muted-foreground p-1 -ml-1"><CaretLeft size={18} /></Link>
        <span className="text-sm font-mono truncate flex-1">{projectName || 'Project'}</span>
        {balance !== null && (
          <span className="text-[10px] font-mono text-muted-foreground px-2 py-1 rounded-full border border-white/10">
            fal {formatUSD(balance)}
          </span>
        )}
      </div>

      {/* Thread feed (newest first) */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {loading ? (
          <p className="text-sm font-mono text-muted-foreground">Loading…</p>
        ) : assets.length === 0 && !busy ? (
          <p className="text-sm font-mono text-muted-foreground/60 text-center pt-12">
            Nothing yet. Describe something below to generate.
          </p>
        ) : null}

        {busy && (
          <div className="rounded-2xl border border-white/10 bg-[#0D0F12] aspect-square flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-accent">
              <CircleNotch size={22} className="animate-spin" />
              <span className="text-[11px] font-mono">{status === 'submitting' ? 'Submitting…' : 'Generating…'}</span>
            </div>
          </div>
        )}

        {assets.map((a) => (
          <div key={a.id} className="rounded-2xl overflow-hidden bg-[#0D0F12] border border-white/10">
            {a.type === 'video' ? (
              <video src={a.r2_url} controls playsInline preload="metadata" className="w-full block" />
            ) : a.type === 'audio' ? (
              <audio src={a.r2_url} controls className="w-full p-3" />
            ) : (
              <img src={a.r2_url} alt="" className="w-full block" loading="lazy" decoding="async" />
            )}
            <div className="px-3.5 py-3 flex flex-col gap-2 border-t border-white/[0.06]">
              {a.prompt && <p className="text-[13px] leading-snug text-foreground/90">{a.prompt}</p>}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                  {a.model && <span className="px-1.5 py-0.5 rounded bg-white/5">{cleanModel(a.model)}</span>}
                  <span>{timeAgo(a.created_at)}</span>
                </div>
                <a
                  href={a.r2_url}
                  download
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-muted-foreground active:scale-95"
                >
                  <DownloadSimple size={15} />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compose bar */}
      <div
        className="shrink-0 border-t border-white/10 bg-[#0D0F12] px-3 pt-3 flex flex-col gap-2.5"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {error && <p className="text-[11px] font-mono text-red-400">{error}</p>}

        {refs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {refs.map((r) => (
              <div key={r.id} className="relative shrink-0">
                <img src={r.previewUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                {r.uploading && (
                  <div className="absolute inset-0 bg-black/55 rounded-lg flex items-center justify-center">
                    <CircleNotch size={14} className="animate-spin text-white" />
                  </div>
                )}
                <button
                  onClick={() => removeRef(r.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black border border-white/25 flex items-center justify-center"
                >
                  <X size={9} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to create"
          rows={2}
          className="bg-[#080A0C] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none resize-none"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="shrink-0 w-9 h-9 rounded-full border border-white/10 bg-[#080A0C] flex items-center justify-center text-muted-foreground active:scale-95"
            aria-label="Attach reference image"
          >
            <ImageSquare size={17} />
          </button>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="flex-1 min-w-0 bg-[#080A0C] border border-white/10 rounded-full px-3 h-9 text-xs font-mono text-foreground focus:outline-none"
          >
            {CREATE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <span className="text-[10px] font-mono text-muted-foreground/70 whitespace-nowrap">
            {cost.isKnown ? `~${formatUSD(cost.total)}` : ''}
          </span>
          <button
            onClick={generate}
            disabled={busy || uploadingRef || !prompt.trim()}
            className="shrink-0 w-9 h-9 rounded-full bg-accent text-[#0D0F12] flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
            aria-label="Generate"
          >
            {busy ? <CircleNotch size={16} className="animate-spin" /> : <ArrowUp size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </div>
  )
}
