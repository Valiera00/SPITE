'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CaretLeft, CircleNotch, ArrowUp, ImageSquare, X, DownloadSimple,
  ArrowUUpLeft, CopySimple, Plus, Minus,
} from '@phosphor-icons/react'
import { FAL_MODELS, getModelById } from '@/lib/fal-models'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'

type Asset = {
  id: string
  type: string
  model: string | null
  r2_url: string
  prompt: string | null
  created_at: string
  aspect?: string
}

type Ref = { id: string; previewUrl: string; proxyUrl: string | null; uploading: boolean }

const CREATE_MODELS = FAL_MODELS.filter((m) => m.category === 'image' && !m.optionalPrompt)
const MAX_COUNT = 6

function findModelId(m: string | null): string | null {
  if (!m) return null
  const hit = CREATE_MODELS.find((x) => x.id === m || x.name === m || x.falModel === m || x.editModel === m)
  return hit?.id ?? null
}
function cleanModel(m: string | null): string {
  if (!m) return ''
  const known = FAL_MODELS.find((x) => x.id === m || x.name === m || x.falModel === m || x.editModel === m)
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
  const [aspect, setAspect] = useState('')
  const [count, setCount] = useState(1)
  const [refs, setRefs] = useState<Ref[]>([])
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)

  const loadBalance = () =>
    fetch('/api/fal/balance').then((r) => r.json())
      .then((d) => setBalance(d?.available && typeof d.balance === 'number' ? d.balance : null))
      .catch(() => {})

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/projects/${projectId}`).then((r) => (r.ok ? r.json() : null)).then((p) => { if (p?.name) setProjectName(p.name) }).catch(() => {})
    fetch(`/api/assets?projectId=${projectId}`).then((r) => r.json())
      .then((d) => setAssets(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
    loadBalance()
  }, [projectId])

  const model = useMemo(() => getModelById(modelId), [modelId])
  useEffect(() => { setAspect(model?.defaultAspectRatio || '') }, [model])
  const cost = useMemo(() => estimateGenerationCost(model, { count }), [model, count])
  const busy = pending > 0
  const uploadingRef = refs.some((r) => r.uploading)
  const decPending = () => setPending((p) => Math.max(0, p - 1))

  function onPickRef(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setRefs((prev) => [...prev, { id, previewUrl: URL.createObjectURL(file), proxyUrl: null, uploading: true }])
    ;(async () => {
      try {
        const presignRes = await fetch('/api/r2-presign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  const removeRef = (id: string) => setRefs((prev) => prev.filter((r) => r.id !== id))

  // One full submit→poll→append. Runs independently so count>1 fans out.
  async function runOne(i: number, myPrompt: string, refUrls: string[], mId: string, asp: string) {
    try {
      if (i > 0) await new Promise((r) => setTimeout(r, i * 250))
      const m = getModelById(mId)
      const submitRes = await fetch('/api/generate/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: mId, prompt: myPrompt,
          referenceImageUrl: refUrls[0],
          referenceGroups: refUrls.length > 1 ? refUrls.slice(1).map((u) => ({ urls: [u] })) : undefined,
          settings: { aspectRatio: asp || m?.defaultAspectRatio, resolution: m?.defaultResolution, numImages: 1 },
        }),
      })
      const submitData = await submitRes.json().catch(() => ({}))
      if (!submitRes.ok || !submitData.request_id) { setError(submitData.error || 'Submit failed'); decPending(); return }
      const { request_id, model: pollModel } = submitData
      for (let k = 0; k < 120; k++) {
        await new Promise((r) => setTimeout(r, 2000))
        const q = new URLSearchParams({ request_id, model: pollModel, prompt: myPrompt, projectId })
        const sd = await (await fetch(`/api/generate/status?${q.toString()}`)).json().catch(() => ({}))
        if (sd.status === 'COMPLETED') {
          const url = sd.output?.url
          if (url) setAssets((prev) => [
            { id: `new-${Date.now()}-${i}`, type: sd.output?.videos ? 'video' : 'image', model: m?.name || null, r2_url: url, prompt: myPrompt, created_at: new Date().toISOString(), aspect: asp },
            ...prev,
          ])
          decPending(); loadBalance(); return
        }
        if (sd.status === 'FAILED') { setError(sd.error || 'Generation failed'); decPending(); return }
      }
      setError('Timed out waiting for a result.'); decPending()
    } catch (err) {
      console.error('[mobile/thread] error:', err); setError('Something went wrong.'); decPending()
    }
  }

  function generate() {
    if (!prompt.trim() || busy || uploadingRef) return
    if (cost.isKnown && cost.total > COST_CONFIRM_THRESHOLD_USD) {
      if (!window.confirm(`This will cost about ${formatUSD(cost.total)}. Generate?`)) return
    }
    const myPrompt = prompt.trim()
    const refUrls = refs.map((r) => r.proxyUrl).filter((u): u is string => !!u)
    const n = Math.max(1, Math.min(MAX_COUNT, count))
    setError(''); setPrompt(''); setRefs([]); setPending(n)
    for (let i = 0; i < n; i++) runOne(i, myPrompt, refUrls, modelId, aspect)
  }

  // Real save: Web Share (iOS → Save to Photos) with a blob-download fallback.
  // The plain <a download> is ignored for cross-origin (R2) URLs.
  async function saveAsset(url: string, type: string) {
    try {
      const blob = await (await fetch(url)).blob()
      const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'
      const file = new File([blob], `spite-${Date.now()}.${ext}`, { type: blob.type || 'application/octet-stream' })
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[] }) => Promise<void> }
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) { await nav.share({ files: [file] }); return }
      const obj = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = obj; a.download = file.name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(obj), 1000)
    } catch (err) {
      console.error('[mobile/save] error:', err); setError('Could not save — long-press the image to save instead.')
    }
  }

  function reusePrompt(a: Asset) { setPrompt(a.prompt || '') }
  function copyAll(a: Asset) {
    setPrompt(a.prompt || '')
    const id = findModelId(a.model)
    if (id) setModelId(id)
    if (a.aspect) setAspect(a.aspect) // model + aspect + prompt; count deliberately left as-is
  }

  return (
    <div className="flex flex-col min-h-[100dvh] bg-[#080A0C] text-[#F0EDE6]">
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach((f) => onPickRef(f)); e.target.value = '' }} />

      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-3 border-b border-white/10 bg-[#080A0C]/90 backdrop-blur" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Link href="/m" className="text-muted-foreground p-1 -ml-1"><CaretLeft size={18} /></Link>
        <span className="text-sm font-mono truncate flex-1">{projectName || 'Project'}</span>
        {balance !== null && (
          <span className="text-[10px] font-mono text-muted-foreground px-2 py-1 rounded-full border border-white/10">fal {formatUSD(balance)}</span>
        )}
        <span className="text-[9px] font-mono text-muted-foreground/40">{(process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)}</span>
      </div>

      {/* Feed — natural document flow. The page (body) scrolls; header and
          compose are sticky. This avoids the iOS nested-overflow scroll that
          left footers stuck below an unreachable fold. */}
      <div className="flex-1 px-4 py-4 flex flex-col gap-4">
        {loading ? (
          <p className="text-sm font-mono text-muted-foreground">Loading…</p>
        ) : assets.length === 0 && !busy ? (
          <p className="text-sm font-mono text-muted-foreground/60 text-center pt-12">Nothing yet. Describe something below to generate.</p>
        ) : null}

        {Array.from({ length: pending }).map((_, i) => (
          <div key={`p-${i}`} className="rounded-2xl border border-white/10 bg-[#0D0F12] aspect-square flex items-center justify-center">
            <CircleNotch size={22} className="animate-spin text-accent" />
          </div>
        ))}

        {assets.map((a) => (
          <div key={a.id} className="rounded-2xl overflow-hidden bg-[#0D0F12] border border-white/10">
            {a.type === 'video' ? (
              <video src={a.r2_url} controls playsInline preload="metadata" className="w-full block max-h-[60vh] object-contain bg-black" />
            ) : a.type === 'audio' ? (
              <audio src={a.r2_url} controls className="w-full p-3" />
            ) : (
              <img src={a.r2_url} alt="" className="w-full block max-h-[60vh] object-contain" loading="lazy" decoding="async" />
            )}
            <div className="px-3.5 py-3 flex flex-col gap-2.5 border-t border-white/[0.06]">
              {a.prompt && <p className="text-[13px] leading-snug text-foreground/90">{a.prompt}</p>}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                  {a.model && <span className="px-1.5 py-0.5 rounded bg-white/5">{cleanModel(a.model)}</span>}
                  {a.aspect && <span className="px-1.5 py-0.5 rounded bg-white/5">{a.aspect}</span>}
                  <span>{timeAgo(a.created_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => reusePrompt(a)} className="flex items-center gap-1 px-2.5 h-7 rounded-full bg-white/10 text-[10px] font-mono text-foreground/80 active:scale-95"><ArrowUUpLeft size={12} /> Reuse</button>
                  <button onClick={() => copyAll(a)} className="flex items-center gap-1 px-2.5 h-7 rounded-full bg-white/10 text-[10px] font-mono text-foreground/80 active:scale-95"><CopySimple size={12} /> Copy</button>
                  <button onClick={() => saveAsset(a.r2_url, a.type)} className="flex items-center gap-1 px-2.5 h-7 rounded-full bg-accent/20 text-[10px] font-mono text-accent active:scale-95"><DownloadSimple size={12} /> Save</button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Compose */}
      <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#0D0F12] px-3 pt-3 flex flex-col gap-2.5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {error && <p className="text-[11px] font-mono text-red-400">{error}</p>}

        {refs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {refs.map((r) => (
              <div key={r.id} className="relative shrink-0">
                <img src={r.previewUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                {r.uploading && <div className="absolute inset-0 bg-black/55 rounded-lg flex items-center justify-center"><CircleNotch size={14} className="animate-spin text-white" /></div>}
                <button onClick={() => removeRef(r.id)} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black border border-white/25 flex items-center justify-center"><X size={9} weight="bold" /></button>
              </div>
            ))}
          </div>
        )}

        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image you want to create" rows={2}
          className="bg-[#080A0C] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:border-accent/50 focus:outline-none resize-none" />

        {/* Settings row */}
        <div className="flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()} aria-label="Attach reference images"
            className="shrink-0 w-9 h-9 rounded-full border border-white/10 bg-[#080A0C] flex items-center justify-center text-muted-foreground active:scale-95"><ImageSquare size={17} /></button>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}
            className="flex-1 min-w-0 bg-[#080A0C] border border-white/10 rounded-full px-3 h-9 text-xs font-mono text-foreground focus:outline-none">
            {CREATE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {model && model.aspectRatios.length > 0 && (
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}
              className="shrink-0 bg-[#080A0C] border border-white/10 rounded-full px-2.5 h-9 text-xs font-mono text-foreground focus:outline-none">
              {model.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
        </div>

        {/* Action row: count, cost, send */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-white/10 rounded-full h-9 px-1 bg-[#080A0C]">
            <button onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground disabled:opacity-30"><Minus size={13} /></button>
            <span className="text-xs font-mono w-4 text-center">{count}</span>
            <button onClick={() => setCount((c) => Math.min(MAX_COUNT, c + 1))} disabled={count >= MAX_COUNT} className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground disabled:opacity-30"><Plus size={13} /></button>
          </div>
          <span className="flex-1 text-[10px] font-mono text-muted-foreground/70 text-right">
            {cost.isKnown ? `~${formatUSD(cost.total)}${count > 1 ? ` · ${count} imgs` : ''}` : ''}
          </span>
          <button onClick={generate} disabled={busy || uploadingRef || !prompt.trim()} aria-label="Generate"
            className="shrink-0 w-9 h-9 rounded-full bg-accent text-[#0D0F12] flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform">
            {busy ? <CircleNotch size={16} className="animate-spin" /> : <ArrowUp size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </div>
  )
}
