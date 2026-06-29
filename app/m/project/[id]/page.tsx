'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  CaretLeft, CircleNotch, ArrowUp, ImageSquare, X, DownloadSimple,
  ArrowUUpLeft, CopySimple, Plus, Minus, Sparkle,
} from '@phosphor-icons/react'
import { FAL_MODELS, getModelById } from '@/lib/fal-models'
import { estimateGenerationCost, formatUSD, COST_CONFIRM_THRESHOLD_USD } from '@/lib/fal-cost'
import { useIsMobile } from '@/components/ui/use-mobile'
import { OnboardingTour } from '@/components/onboarding/use-onboarding-tour'

type Asset = {
  id: string
  type: string
  model: string | null
  r2_url: string
  prompt: string | null
  created_at: string
  aspect?: string
  refs?: string[]
}

type Ref = { id: string; previewUrl: string; proxyUrl: string | null; uploading: boolean }

// Flow mode — the simple, linear prompt→result generation thread (the
// counterpart to Canvas). One responsive component: a phone-optimized single
// column, and a wider multi-column desktop layout. Served under /m so existing
// bookmarks keep working.

// Rebuild compose-bar ref chips from stored URLs (used by Reuse / Copy). The
// proxy URL doubles as the preview source since it's already on R2.
function refsFromUrls(urls?: string[]): Ref[] {
  return (urls || []).map((url, i) => ({ id: `ref-restore-${Date.now()}-${i}`, previewUrl: url, proxyUrl: url, uploading: false }))
}

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

// Reserve the media box from the requested aspect (e.g. "16:9", "3:4") so a card
// doesn't grow/jump when the lazy image finishes loading. (Phone, full-width
// media only; desktop uses a fixed media height.)
function aspectStyle(a?: string): React.CSSProperties | undefined {
  if (!a) return undefined
  const m = a.match(/^\s*(\d+)\s*[:x/]\s*(\d+)\s*$/)
  if (!m) return undefined
  return { aspectRatio: `${m[1]} / ${m[2]}` }
}


export default function FlowThread() {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const fileRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()

  const [projectName, setProjectName] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [modelId, setModelId] = useState(CREATE_MODELS[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('')
  const [count, setCount] = useState(1)
  const [resolution, setResolution] = useState('')
  const [refs, setRefs] = useState<Ref[]>([])
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)

  // Chat-style thread: oldest at top, newest at the bottom. Sentinel at the end
  // of the feed that we scroll to so you land on the latest result on entry and
  // stay pinned as new ones append.
  const endRef = useRef<HTMLDivElement>(null)
  const nearBottom = () =>
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 280
  const pinToNewest = (force = false) => {
    if (force || nearBottom()) endRef.current?.scrollIntoView({ block: 'end' })
  }

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

  // Land on / stay pinned to the newest item on entry and whenever a generation
  // starts (pending) or completes (assets.length). rAF so layout settles first.
  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => pinToNewest(true))
    return () => cancelAnimationFrame(id)
  }, [loading, assets.length, pending])

  const model = useMemo(() => getModelById(modelId), [modelId])
  // Default a model's resolution to 2K when it offers it (never go lower by
  // default); otherwise fall back to the model's own default or its highest tier.
  useEffect(() => {
    setAspect(model?.defaultAspectRatio || '')
    const rs = model?.resolutions || []
    setResolution(
      rs.includes('2K') ? '2K'
        : (model?.defaultResolution && rs.includes(model.defaultResolution)) ? model.defaultResolution
        : rs[rs.length - 1] || '',
    )
  }, [model])
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
          body: JSON.stringify({ filename: file.name, contentType: file.type, prefix: 'refs' }),
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
  async function runOne(i: number, myPrompt: string, refUrls: string[], mId: string, asp: string, res: string) {
    try {
      if (i > 0) await new Promise((r) => setTimeout(r, i * 250))
      const m = getModelById(mId)
      const submitRes = await fetch('/api/generate/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: mId, prompt: myPrompt,
          referenceImageUrl: refUrls[0],
          referenceGroups: refUrls.length > 1 ? refUrls.slice(1).map((u) => ({ urls: [u] })) : undefined,
          settings: { aspectRatio: asp || m?.defaultAspectRatio, resolution: res || m?.defaultResolution, numImages: 1 },
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
          if (url) {
            setAssets((prev) => [
              { id: `new-${Date.now()}-${i}`, type: sd.output?.videos ? 'video' : 'image', model: m?.name || null, r2_url: url, prompt: myPrompt, created_at: new Date().toISOString(), aspect: asp, refs: refUrls },
              ...prev,
            ])
            // Persist the references against this result so Reuse can restore
            // them after a reload too (best-effort; in-memory state covers the
            // current session regardless).
            if (refUrls.length) fetch('/api/assets', {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, refs: refUrls, projectId }),
            }).catch(() => {})
          }
          decPending(); loadBalance(); return
        }
        if (sd.status === 'FAILED') { setError(sd.error || 'Generation failed'); decPending(); return }
      }
      setError('Timed out waiting for a result.'); decPending()
    } catch (err) {
      console.error('[flow/thread] error:', err); setError('Something went wrong.'); decPending()
    }
  }

  function generate() {
    if (!prompt.trim() || busy || uploadingRef) return
    if (cost.isKnown && cost.total > COST_CONFIRM_THRESHOLD_USD) {
      if (!window.confirm(`This will cost about ${formatUSD(cost.total)}. Generate?`)) return
    }
    const myPrompt = prompt.trim()
    // De-dupe so the same reference can't be sent (or stored) twice, even if it
    // ended up attached more than once.
    const refUrls = [...new Set(refs.map((r) => r.proxyUrl).filter((u): u is string => !!u))]
    const n = Math.max(1, Math.min(MAX_COUNT, count))
    setError(''); setPrompt(''); setRefs([]); setPending(n)
    for (let i = 0; i < n; i++) runOne(i, myPrompt, refUrls, modelId, aspect, resolution)
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
      console.error('[flow/save] error:', err); setError('Could not save — long-press the image to save instead.')
    }
  }

  function reusePrompt(a: Asset) {
    setPrompt(a.prompt || '')
    setRefs(refsFromUrls(a.refs)) // bring back the reference images that were used
  }
  function copyAll(a: Asset) {
    setPrompt(a.prompt || '')
    const id = findModelId(a.model)
    if (id) setModelId(id)
    if (a.aspect) setAspect(a.aspect)
    setRefs(refsFromUrls(a.refs)) // model + aspect + prompt + references; count deliberately left as-is
  }

  return (
    <div className="text-[#F0EDE6]">
      {/* Desktop only: SPITE brand atmosphere behind a centered column. On phone
          the column is flat #080A0C for performance. */}
      <div className="spite-ozone-bg hidden lg:block fixed inset-0 z-0 pointer-events-none" aria-hidden="true" />
      <div className="spite-grain hidden lg:block" aria-hidden="true" />

      <div className="relative z-10 flex flex-col min-h-[100dvh] w-full bg-[#080A0C] lg:bg-transparent">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach((f) => onPickRef(f)); e.target.value = '' }} />

        {/* Header — full-width bar; backdrop-blur on phone, glass on desktop.
            Back returns to the dashboard on desktop, to the Flow list on phone. */}
        <div className="sticky top-0 z-20 w-full border-b border-white/10 bg-[#080A0C]/90 backdrop-blur lg:bg-[#0A0C10]/70 lg:glass" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
          <div className="w-full max-w-[1700px] mx-auto flex items-center gap-2 px-3 pb-3 pt-0.5 lg:px-7">
            <Link href={isMobile ? '/m' : '/'} className="text-muted-foreground p-1 -ml-1 hover:text-foreground transition-colors"><CaretLeft size={18} /></Link>
            <span className="text-sm font-mono truncate flex-1">{projectName || 'Project'}</span>
            {balance !== null && (
              <span className="text-[10px] font-mono text-muted-foreground px-2 py-1 rounded-full border border-white/10">fal {formatUSD(balance)}</span>
            )}
            <span className="text-[9px] font-mono text-muted-foreground/40">{(process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)}</span>
          </div>
        </div>

      {/* Feed. Krea-style on desktop: each generation is a row with a compact
          prompt card on the left and a large image on the right. On phone it
          stacks (image, then the prompt card below). Newest at the bottom. */}
      <div className="flex-1 w-full max-w-[1700px] mx-auto px-4 py-4 lg:px-7 lg:py-8 pb-36 lg:pb-56 flex flex-col gap-5 lg:gap-8">
        {loading ? (
          <p className="text-sm font-mono text-muted-foreground">Loading…</p>
        ) : assets.length === 0 && !busy ? (
          <p className="text-sm font-mono text-muted-foreground/60 text-center pt-12">Nothing yet. Describe something below to generate.</p>
        ) : null}

        {/* Oldest first → newest at the bottom. `assets` is stored newest-first
            (prepended), so render a reversed copy for chronological order. */}
        {assets.slice().reverse().map((a, ri) => (
          <div key={a.id} className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
            {/* Prompt card — left on desktop, below the image on phone. */}
            <div {...(ri === 0 ? { 'data-tour': 'result' } : {})} className="order-2 lg:order-1 w-full lg:w-[260px] lg:shrink-0 rounded-2xl bg-white/[0.035] border border-white/[0.06] px-3.5 py-3 flex flex-col gap-3">
              {a.prompt && <p className="text-[12.5px] leading-relaxed text-foreground/70">{a.prompt}</p>}
              {(a.refs?.length ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {a.refs!.slice(0, 4).map((u, i) => (
                    <img key={i} src={u} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }}
                      className="w-11 h-11 rounded-lg object-cover border border-white/15 bg-black/40" />
                  ))}
                  {a.refs!.length > 4 && <span className="text-[10px] font-mono text-muted-foreground/60">+{a.refs!.length - 4}</span>}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                {a.model && (
                  <span className="flex items-center gap-1 min-w-0 text-[10px] font-mono text-muted-foreground/80 px-1.5 py-0.5 rounded bg-white/5">
                    <Sparkle size={9} weight="fill" className="text-accent/70 shrink-0" /><span className="truncate">{cleanModel(a.model)}</span>
                  </span>
                )}
                <span className="shrink-0 text-[9px] font-mono text-muted-foreground/40">{timeAgo(a.created_at)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => reusePrompt(a)} title="Reuse prompt + references" className="flex items-center gap-1 px-2 h-6 rounded-full bg-white/5 hover:bg-white/10 text-[10px] font-mono text-foreground/70 active:scale-95 transition"><ArrowUUpLeft size={11} /> Reuse</button>
                <button onClick={() => copyAll(a)} title="Copy settings" className="flex items-center justify-center w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 text-foreground/70 active:scale-95 transition"><CopySimple size={11} /></button>
                <button onClick={() => saveAsset(a.r2_url, a.type)} title="Save" className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 hover:bg-accent/25 text-accent active:scale-95 transition"><DownloadSimple size={11} /></button>
              </div>
            </div>
            {/* Media — right on desktop, top on phone. Sized to be as large as
                fits (capped by viewport height / available width), any aspect. */}
            <div className="order-1 lg:order-2 lg:flex-1 lg:min-w-0">
              {a.type === 'video' ? (
                <video src={a.r2_url} controls playsInline preload="metadata" onLoadedMetadata={() => pinToNewest(false)} style={aspectStyle(a.aspect)} className="block w-full lg:w-auto max-w-full max-h-[82vh] object-contain bg-black rounded-2xl" />
              ) : a.type === 'audio' ? (
                <audio src={a.r2_url} controls className="w-full lg:w-[420px] p-3" />
              ) : (
                <img src={a.r2_url} alt="" onLoad={() => pinToNewest(false)} style={aspectStyle(a.aspect)} className="block w-full lg:w-auto max-w-full max-h-[82vh] object-contain rounded-2xl" loading="lazy" decoding="async" />
              )}
            </div>
          </div>
        ))}

        {/* In-flight generations: spinner in the image column, where the result lands. */}
        {Array.from({ length: pending }).map((_, i) => (
          <div key={`p-${i}`} className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
            <div className="hidden lg:block lg:w-[260px] lg:shrink-0" />
            <div className="rounded-2xl border border-white/10 bg-[#0D0F12] flex items-center justify-center w-full aspect-square lg:aspect-auto lg:w-[460px] lg:h-[60vh]">
              <CircleNotch size={26} className="animate-spin text-accent" />
            </div>
          </div>
        ))}

        <div ref={endRef} className="lg:scroll-mb-56" />
      </div>

      {/* Compose — floating rounded card. A soft glow wraps it (idle), brightening
          and gently breathing when the box or any of its controls is focused
          (live), echoing the Canvas connector glow. */}
      <div className="sticky bottom-0 z-20 px-3 lg:px-0 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="relative mx-auto w-full lg:max-w-2xl group">
          {/* Glow halo behind the card — dim idle, bright + pulsing when focused. */}
          <div aria-hidden="true"
            className="pointer-events-none absolute -inset-[2px] rounded-[18px] blur-[7px] opacity-25 transition-all duration-500 group-focus-within:opacity-90 group-focus-within:blur-[11px] group-focus-within:animate-pulse"
            style={{ background: 'linear-gradient(115deg, rgba(174,195,210,0.5), rgba(231,241,251,0.75), rgba(107,143,168,0.5))' }} />
          <div data-tour="compose" className="relative rounded-2xl border border-white/10 group-focus-within:border-[#aec3d2]/30 bg-[#141414]/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] px-3 pt-3 pb-2.5 flex flex-col gap-2.5 transition-colors">
            {error && <p className="text-[11px] font-mono text-red-400">{error}</p>}

            {refs.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {refs.map((r) => (
                  <div key={r.id} className="relative shrink-0">
                    <img
                      src={r.previewUrl}
                      alt=""
                      className="w-16 h-16 rounded-xl object-cover border border-white/10"
                      onError={() => {
                        // A restored reference whose image won't load has been
                        // reclaimed by retention — drop it and let the user know.
                        setRefs((prev) => prev.filter((x) => x.id !== r.id))
                        setError('Some references expired and could not be restored.')
                      }}
                    />
                    {r.uploading && <div className="absolute inset-0 bg-black/55 rounded-xl flex items-center justify-center"><CircleNotch size={16} className="animate-spin text-white" /></div>}
                    <button onClick={() => removeRef(r.id)} aria-label="Remove reference" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/90 border border-white/30 flex items-center justify-center hover:bg-black active:scale-95 transition"><X size={11} weight="bold" /></button>
                  </div>
                ))}
              </div>
            )}

          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe an image and click generate…" rows={2}
            className="bg-transparent px-1 pt-0.5 text-[15px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-none" />

          {/* Control row: pills wrap on the left, generate pinned right. */}
          <div className="flex items-end gap-2">
            <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
              <select data-tour="model" value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model"
                className="appearance-none w-[150px] lg:w-[180px] bg-white/[0.06] hover:bg-white/10 transition rounded-full px-3 h-8 text-[11px] font-mono text-foreground/90 focus:outline-none cursor-pointer">
                {CREATE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {model && model.aspectRatios.length > 0 && (
                <select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Aspect ratio"
                  className="appearance-none bg-white/[0.06] hover:bg-white/10 transition rounded-full px-2.5 h-8 text-[11px] font-mono text-foreground/90 focus:outline-none cursor-pointer">
                  {model.aspectRatios.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {model && (model.resolutions?.length ?? 0) > 1 && (
                <select value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label="Resolution"
                  className="appearance-none bg-white/[0.06] hover:bg-white/10 transition rounded-full px-2.5 h-8 text-[11px] font-mono text-foreground/90 focus:outline-none cursor-pointer">
                  {model.resolutions!.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <button data-tour="attach" onClick={() => fileRef.current?.click()} aria-label="Attach reference images"
                className="flex items-center gap-1 h-8 px-2.5 rounded-full bg-white/[0.06] hover:bg-white/10 transition text-[11px] font-mono text-foreground/80 active:scale-95">
                <ImageSquare size={14} />{refs.length > 0 ? refs.length : ''}
              </button>
              <div className="flex items-center gap-0.5 h-8 px-1.5 rounded-full bg-white/[0.06]">
                <button onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} aria-label="Fewer" className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground"><Minus size={12} /></button>
                <span className="text-[11px] font-mono w-3.5 text-center">{count}</span>
                <button onClick={() => setCount((c) => Math.min(MAX_COUNT, c + 1))} disabled={count >= MAX_COUNT} aria-label="More" className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground disabled:opacity-30 hover:text-foreground"><Plus size={12} /></button>
              </div>
              {cost.isKnown && (
                <span className="text-[10px] font-mono text-muted-foreground/55 px-1">~{formatUSD(cost.total)}{count > 1 ? ` · ${count}` : ''}</span>
              )}
            </div>
            <button data-tour="generate" onClick={generate} disabled={busy || uploadingRef || !prompt.trim()} aria-label="Generate"
              className="shrink-0 w-9 h-9 rounded-full bg-accent text-[#0D0F12] flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform">
              {busy ? <CircleNotch size={16} className="animate-spin" /> : <ArrowUp size={18} weight="bold" />}
            </button>
          </div>
          </div>
        </div>
      </div>
      </div>

      <OnboardingTour surface="flow" />
    </div>
  )
}
