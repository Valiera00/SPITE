'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  X, Crop, PaintBrush, Sliders, ArrowCounterClockwise, Eraser, CircleNotch, Trash,
} from '@phosphor-icons/react'
import { bytesUrl } from '@/lib/asset-url'
import {
  applyAdjustments, isNeutral, NEUTRAL_ADJUSTMENTS, type Adjustments,
  CROP_PRESETS, fitCrop, clampCrop, isFullCrop, type CropRect,
} from '@/lib/photo-adjust'

// ---------------------------------------------------------------------------
// Simple photo editor: crop, paint, colour grading. Opens over the canvas,
// saves the result as a NEW asset (the original is never touched) and hands
// it back through onSaved so the caller can drop it on the canvas or refresh
// the library.
//
// How the image is handled:
//   base       full-resolution source, drawn once from same-origin bytes
//   paint      full-resolution transparent layer the brush draws into
//   preview    base downscaled to ~1600px — the Adjust sliders re-run the
//              pixel math on THIS while dragging, which is why they feel live
//   display    what's on screen: adjusted preview + paint layer + crop frame
// At export the same pixel math runs once on the full-resolution crop, so the
// saved file matches the preview exactly.
// ---------------------------------------------------------------------------

type Tool = 'crop' | 'paint' | 'adjust'

interface Stroke {
  points: { x: number; y: number }[]   // image coordinates
  size: number                          // image pixels
  color: string
  opacity: number
  erase: boolean
}

export interface SavedEdit {
  id: string
  r2_url: string
  label: string
}

interface Props {
  open: boolean
  url: string | null | undefined
  label?: string
  onClose: () => void
  onSaved?: (asset: SavedEdit) => void
}

const PREVIEW_MAX = 1600
const SWATCHES = ['#ffffff', '#000000', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a78bfa', '#aec3d2']
const HANDLE = 10 // px, on screen

type DragMode =
  | { kind: 'none' }
  | { kind: 'paint' }
  | { kind: 'crop-move'; start: { x: number; y: number }; rect: CropRect }
  | { kind: 'crop-resize'; corner: string; start: { x: number; y: number }; rect: CropRect }

export function PhotoEditor({ open, url, label, onClose, onSaved }: Props) {
  const params = useParams()
  const projectId = (params?.id as string) || ''

  const [tool, setTool] = useState<Tool>('adjust')
  // Portal target only exists in the browser; render nothing until mounted so
  // server and first client render agree (otherwise React logs a hydration
  // mismatch when the editor is open on first paint).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  // Full-res layers live in refs — they're big and never need to re-render React.
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const paintRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)        // downscaled base
  const previewDataRef = useRef<ImageData | null>(null)             // its untouched pixels
  const adjustedRef = useRef<HTMLCanvasElement | null>(null)        // preview after adjustments
  const displayRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const fitRef = useRef({ scale: 1, ox: 0, oy: 0, cw: 0, ch: 0 })

  const [adj, setAdj] = useState<Adjustments>(NEUTRAL_ADJUSTMENTS)
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
  const [cropRatio, setCropRatio] = useState<number | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [brushSize, setBrushSize] = useState(24)
  const [brushColor, setBrushColor] = useState('#ffffff')
  const [brushOpacity, setBrushOpacity] = useState(1)
  const [erase, setErase] = useState(false)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<DragMode>({ kind: 'none' })
  const currentStrokeRef = useRef<Stroke | null>(null)
  const rafRef = useRef<number | null>(null)

  const dirty = strokes.length > 0 || !isNeutral(adj) || (dims ? !isFullCrop(crop, dims.w, dims.h) : false)

  // Callers pass inline arrows for onClose; reading it through a ref keeps it
  // out of the load effect's dependencies, otherwise every parent render
  // would restart (and cancel) the image load.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // ---- load --------------------------------------------------------------
  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    setLoading(true)
    setDims(null)
    setAdj(NEUTRAL_ADJUSTMENTS)
    setStrokes([])
    setCropRatio(null)
    setTool('adjust')
    ;(async () => {
      try {
        const res = await fetch(bytesUrl(url))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const bmp = await createImageBitmap(blob)
        if (cancelled) return
        const w = bmp.width, h = bmp.height

        const base = document.createElement('canvas')
        base.width = w; base.height = h
        base.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close?.()
        baseRef.current = base

        const paint = document.createElement('canvas')
        paint.width = w; paint.height = h
        paintRef.current = paint

        const ps = Math.min(1, PREVIEW_MAX / Math.max(w, h))
        const pw = Math.max(1, Math.round(w * ps)), ph = Math.max(1, Math.round(h * ps))
        const preview = document.createElement('canvas')
        preview.width = pw; preview.height = ph
        const pctx = preview.getContext('2d')!
        pctx.drawImage(base, 0, 0, pw, ph)
        previewRef.current = preview
        previewDataRef.current = pctx.getImageData(0, 0, pw, ph)
        const adjusted = document.createElement('canvas')
        adjusted.width = pw; adjusted.height = ph
        adjusted.getContext('2d')!.drawImage(preview, 0, 0)
        adjustedRef.current = adjusted

        setCrop({ x: 0, y: 0, width: w, height: h })
        setDims({ w, h })
      } catch (err) {
        console.error('[photo-editor] load failed', err)
        toast.error('Could not open this image for editing')
        onCloseRef.current()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, url])

  // ---- adjustments -> preview ------------------------------------------------
  useEffect(() => {
    const src = previewDataRef.current, out = adjustedRef.current
    if (!src || !out) return
    const copy = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
    applyAdjustments(copy, adj)
    out.getContext('2d')!.putImageData(copy, 0, 0)
    scheduleDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adj, dims])

  // ---- strokes -> paint layer (full rebuild; only on undo/clear) ----------
  const rebuildPaint = useCallback((list: Stroke[]) => {
    const paint = paintRef.current
    if (!paint) return
    const ctx = paint.getContext('2d')!
    ctx.clearRect(0, 0, paint.width, paint.height)
    for (const s of list) drawStroke(ctx, s)
    scheduleDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- fit + draw -----------------------------------------------------------
  const computeFit = useCallback(() => {
    const stage = stageRef.current, display = displayRef.current
    if (!stage || !display || !dims) return
    const cw = stage.clientWidth, ch = stage.clientHeight
    const scale = Math.min(cw / dims.w, ch / dims.h)
    const ox = (cw - dims.w * scale) / 2, oy = (ch - dims.h * scale) / 2
    fitRef.current = { scale, ox, oy, cw, ch }
    const dpr = window.devicePixelRatio || 1
    if (display.width !== Math.round(cw * dpr) || display.height !== Math.round(ch * dpr)) {
      display.width = Math.round(cw * dpr); display.height = Math.round(ch * dpr)
      display.style.width = `${cw}px`; display.style.height = `${ch}px`
    }
  }, [dims])

  const draw = useCallback(() => {
    rafRef.current = null
    const display = displayRef.current, adjusted = adjustedRef.current, paint = paintRef.current
    if (!display || !adjusted || !paint || !dims) return
    computeFit()
    const { scale, ox, oy, cw, ch } = fitRef.current
    const dpr = window.devicePixelRatio || 1
    const ctx = display.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const dw = dims.w * scale, dh = dims.h * scale
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(adjusted, ox, oy, dw, dh)
    ctx.drawImage(paint, ox, oy, dw, dh)

    // Crop frame: dim outside, border, handles while cropping.
    const showCrop = tool === 'crop' || !isFullCrop(crop, dims.w, dims.h)
    if (showCrop) {
      const cx = ox + crop.x * scale, cy = oy + crop.y * scale
      const cwid = crop.width * scale, chei = crop.height * scale
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.beginPath()
      ctx.rect(ox, oy, dw, dh)
      ctx.rect(cx, cy, cwid, chei)
      ctx.fill('evenodd')
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(cx + 0.5, cy + 0.5, cwid - 1, chei - 1)
      if (tool === 'crop') {
        // thirds
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'
        for (let i = 1; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(cx + (cwid * i) / 3, cy); ctx.lineTo(cx + (cwid * i) / 3, cy + chei); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(cx, cy + (chei * i) / 3); ctx.lineTo(cx + cwid, cy + (chei * i) / 3); ctx.stroke()
        }
        ctx.fillStyle = '#fff'
        for (const [hx, hy] of handlePoints(cx, cy, cwid, chei)) {
          ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
        }
      }
    }

    // Brush cursor ring.
    if (tool === 'paint' && hoverRef.current) {
      const r = (brushSize * scale) / 2
      const hx = ox + hoverRef.current.x * scale, hy = oy + hoverRef.current.y * scale
      ctx.beginPath(); ctx.arc(hx, hy, Math.max(2, r), 0, Math.PI * 2)
      ctx.strokeStyle = erase ? 'rgba(255,120,120,0.9)' : 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }, [dims, crop, tool, brushSize, erase, computeFit])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => draw())
  }, [draw])

  useEffect(() => { scheduleDraw() }, [scheduleDraw, crop, tool, dims])

  useEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => scheduleDraw())
    ro.observe(stage)
    return () => ro.disconnect()
  }, [open, scheduleDraw])

  // Escape closes (with a check if there's unsaved work).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tool === 'paint') {
        e.preventDefault(); undoStroke()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty, tool, strokes])

  const requestClose = () => {
    if (saving) return
    if (dirty && !window.confirm('Discard your edits?')) return
    onClose()
  }

  // ---- pointer ----------------------------------------------------------
  const toImage = (e: React.PointerEvent) => {
    const display = displayRef.current!
    const r = display.getBoundingClientRect()
    const { scale, ox, oy } = fitRef.current
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dims || e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pen/touch edge cases */ }
    const p = toImage(e)
    if (tool === 'paint') {
      const s: Stroke = { points: [p], size: brushSize, color: brushColor, opacity: brushOpacity, erase }
      currentStrokeRef.current = s
      dragRef.current = { kind: 'paint' }
      drawStroke(paintRef.current!.getContext('2d')!, s)
      scheduleDraw()
    } else if (tool === 'crop') {
      const corner = hitHandle(p, crop, fitRef.current.scale)
      if (corner) dragRef.current = { kind: 'crop-resize', corner, start: p, rect: crop }
      else if (inside(p, crop)) dragRef.current = { kind: 'crop-move', start: p, rect: crop }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dims) return
    const p = toImage(e)
    hoverRef.current = p
    const d = dragRef.current
    if (d.kind === 'paint' && currentStrokeRef.current) {
      const s = currentStrokeRef.current
      const last = s.points[s.points.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
        s.points.push(p)
        drawSegment(paintRef.current!.getContext('2d')!, s, last, p)
      }
      scheduleDraw()
    } else if (d.kind === 'crop-move') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y
      setCrop(clampCrop({ ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy }, dims.w, dims.h))
    } else if (d.kind === 'crop-resize') {
      setCrop(resizeCrop(d.rect, d.corner, p, cropRatio, dims.w, dims.h))
    } else if (tool === 'paint') {
      scheduleDraw()
    }
    if (tool === 'crop' && d.kind === 'none') {
      const c = hitHandle(p, crop, fitRef.current.scale)
      e.currentTarget.style.cursor = c ? cursorFor(c) : inside(p, crop) ? 'move' : 'default'
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    dragRef.current = { kind: 'none' }
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (d.kind === 'paint' && currentStrokeRef.current) {
      const s = currentStrokeRef.current
      currentStrokeRef.current = null
      setStrokes((list) => [...list, s])
    }
  }

  const onPointerLeave = () => { hoverRef.current = null; scheduleDraw() }

  const undoStroke = () => {
    setStrokes((list) => {
      const next = list.slice(0, -1)
      rebuildPaint(next)
      return next
    })
  }
  const clearPaint = () => { setStrokes([]); rebuildPaint([]) }

  const applyPreset = (ratio: number | null) => {
    if (!dims) return
    setCropRatio(ratio)
    setCrop(fitCrop(dims.w, dims.h, ratio))
  }

  // ---- save -----------------------------------------------------------------
  const save = async () => {
    const base = baseRef.current, paint = paintRef.current
    if (!base || !paint || !dims || saving) return
    if (!projectId) { toast.error('No project to save into'); return }
    setSaving(true)
    const toastId = toast.loading('Saving edited image…')
    try {
      const out = document.createElement('canvas')
      out.width = crop.width; out.height = crop.height
      const ctx = out.getContext('2d')!
      ctx.drawImage(base, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
      if (!isNeutral(adj)) {
        const d = ctx.getImageData(0, 0, crop.width, crop.height)
        applyAdjustments(d, adj)
        ctx.putImageData(d, 0, 0)
      }
      ctx.drawImage(paint, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
      const blob: Blob = await new Promise((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'),
      )

      // Same upload path the canvas uses for dropped files: presigned PUT
      // straight to R2 (no Vercel body limit), then record the asset.
      const filename = `edited-${Date.now()}.png`
      const presignRes = await fetch('/api/r2-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType: 'image/png' }),
      })
      if (!presignRes.ok) throw new Error(`presign failed: ${presignRes.status}`)
      const { presignedUrl, proxyUrl } = (await presignRes.json()) as { presignedUrl: string; proxyUrl: string }
      const put = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob })
      if (!put.ok) throw new Error(`upload failed: ${put.status}`)

      const newLabel = `${label || 'Image'} (edited)`
      const rec = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: proxyUrl, type: 'image', filename: newLabel, projectId }),
      })
      const data = (await rec.json().catch(() => ({}))) as { id?: string }
      if (!rec.ok || !data.id) throw new Error('could not record asset')

      window.dispatchEvent(new CustomEvent('asset-status-changed'))
      toast.success('Saved as a new asset', { id: toastId })
      onSaved?.({ id: data.id, r2_url: proxyUrl, label: newLabel })
      onClose()
    } catch (err) {
      console.error('[photo-editor] save failed', err)
      toast.error(err instanceof Error ? err.message : 'Save failed', { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  const cropLabel = useMemo(() => `${crop.width} × ${crop.height}`, [crop])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-[#07080a] text-foreground"
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-white/10">
        <span className="text-sm font-medium">Edit photo</span>
        {label && <span className="text-xs text-muted-foreground/60 truncate max-w-[280px]">{label}</span>}
        <div className="mx-auto flex items-center gap-1 rounded-full bg-white/[0.05] p-1">
          <ToolTab active={tool === 'crop'} onClick={() => setTool('crop')} icon={Crop} label="Crop" />
          <ToolTab active={tool === 'paint'} onClick={() => setTool('paint')} icon={PaintBrush} label="Paint" />
          <ToolTab active={tool === 'adjust'} onClick={() => setTool('adjust')} icon={Sliders} label="Adjust" />
        </div>
        <button onClick={requestClose} disabled={saving}
          className="px-3 h-8 rounded-lg text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40">
          Cancel
        </button>
        <button onClick={save} disabled={saving || loading || !dims}
          title="Saves a new asset — the original is untouched"
          className="flex items-center gap-2 px-4 h-8 rounded-lg bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors disabled:opacity-40">
          {saving && <CircleNotch size={12} className="animate-spin" />}
          Save as new asset
        </button>
        <button onClick={requestClose} aria-label="Close"
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors">
          <X size={14} weight="bold" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Stage */}
        <div ref={stageRef} className="flex-1 relative overflow-hidden dot-grid">
          <canvas
            ref={displayRef}
            className="absolute inset-0"
            style={{ cursor: tool === 'paint' ? 'none' : tool === 'crop' ? 'default' : 'default', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerLeave}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs font-mono text-muted-foreground/60">
              <CircleNotch size={16} className="animate-spin" /> Loading full-resolution image…
            </div>
          )}
        </div>

        {/* Options */}
        <aside className="w-72 shrink-0 border-l border-white/10 p-4 overflow-y-auto space-y-5">
          {tool === 'crop' && (
            <>
              <Section title="Aspect">
                <div className="flex flex-wrap gap-1.5">
                  {CROP_PRESETS.map((p) => (
                    <button key={p.label} onClick={() => applyPreset(p.ratio)}
                      className={`px-2.5 h-7 rounded-full text-[11px] font-mono transition-colors ${
                        cropRatio === p.ratio ? 'bg-accent/20 text-accent' : 'bg-white/[0.06] hover:bg-white/10 text-foreground/80'
                      }`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Size">
                <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>{cropLabel}</span>
                  <button onClick={() => applyPreset(null)} className="flex items-center gap-1 hover:text-foreground">
                    <ArrowCounterClockwise size={11} /> Reset
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                  Drag inside the frame to move it, drag a corner or edge to resize.
                </p>
              </Section>
            </>
          )}

          {tool === 'paint' && (
            <>
              <Section title="Colour">
                <div className="flex flex-wrap items-center gap-1.5">
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => { setBrushColor(c); setErase(false) }} aria-label={c}
                      className={`w-6 h-6 rounded-full border ${brushColor === c && !erase ? 'border-accent ring-2 ring-accent/40' : 'border-white/20'}`}
                      style={{ background: c }} />
                  ))}
                  <label className="relative w-6 h-6 rounded-full border border-white/20 overflow-hidden cursor-pointer"
                    style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} title="Custom colour">
                    <input type="color" value={brushColor} onChange={(e) => { setBrushColor(e.target.value); setErase(false) }}
                      className="absolute inset-0 opacity-0 cursor-pointer" />
                  </label>
                </div>
              </Section>
              <Slider label="Size" value={brushSize} min={2} max={300} onChange={setBrushSize} format={(v) => `${v}px`} />
              <Slider label="Opacity" value={Math.round(brushOpacity * 100)} min={5} max={100} onChange={(v) => setBrushOpacity(v / 100)} format={(v) => `${v}%`} />
              <div className="flex items-center gap-1.5">
                <button onClick={() => setErase((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-mono transition-colors ${
                    erase ? 'bg-rose-500/20 text-rose-300' : 'bg-white/[0.06] hover:bg-white/10 text-foreground/80'}`}>
                  <Eraser size={12} /> Eraser
                </button>
                <button onClick={undoStroke} disabled={strokes.length === 0}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-mono bg-white/[0.06] hover:bg-white/10 text-foreground/80 disabled:opacity-30">
                  <ArrowCounterClockwise size={12} /> Undo
                </button>
                <button onClick={clearPaint} disabled={strokes.length === 0}
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-mono bg-white/[0.06] hover:bg-white/10 text-foreground/80 disabled:opacity-30">
                  <Trash size={12} /> Clear
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                Paint sits on its own layer above the photo; the eraser only removes paint. Ctrl+Z undoes a stroke.
              </p>
            </>
          )}

          {tool === 'adjust' && (
            <>
              <Slider label="Exposure" value={adj.exposure} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, exposure: v }))} resettable />
              <Slider label="Contrast" value={adj.contrast} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, contrast: v }))} resettable />
              <Slider label="Saturation" value={adj.saturation} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, saturation: v }))} resettable />
              <Slider label="Temperature" value={adj.temperature} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, temperature: v }))} resettable hint="cool ← → warm" />
              <Slider label="Tint" value={adj.tint} min={-100} max={100} onChange={(v) => setAdj((a) => ({ ...a, tint: v }))} resettable hint="green ← → magenta" />
              <Slider label="Vignette" value={adj.vignette} min={0} max={100} onChange={(v) => setAdj((a) => ({ ...a, vignette: v }))} resettable />
              <button onClick={() => setAdj(NEUTRAL_ADJUSTMENTS)} disabled={isNeutral(adj)}
                className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ArrowCounterClockwise size={11} /> Reset all
              </button>
            </>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers

function strokeStyle(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = s.size
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.globalAlpha = s.opacity
  ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
}

function drawSegment(ctx: CanvasRenderingContext2D, s: Stroke, a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.save()
  strokeStyle(ctx, s)
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  ctx.restore()
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.save()
  strokeStyle(ctx, s)
  if (s.points.length === 1) {
    const p = s.points[0]
    ctx.beginPath(); ctx.arc(p.x, p.y, s.size / 2, 0, Math.PI * 2); ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Crop helpers (image coordinates unless noted)

function inside(p: { x: number; y: number }, c: CropRect) {
  return p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height
}

function handlePoints(x: number, y: number, w: number, h: number): [number, number][] {
  return [
    [x, y], [x + w / 2, y], [x + w, y],
    [x, y + h / 2], [x + w, y + h / 2],
    [x, y + h], [x + w / 2, y + h], [x + w, y + h],
  ]
}
const HANDLE_NAMES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

function hitHandle(p: { x: number; y: number }, c: CropRect, scale: number): string | null {
  const tol = (HANDLE + 4) / scale / 2
  const pts = handlePoints(c.x, c.y, c.width, c.height)
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(p.x - pts[i][0]) <= tol && Math.abs(p.y - pts[i][1]) <= tol) return HANDLE_NAMES[i]
  }
  return null
}

function cursorFor(h: string) {
  return ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize' } as Record<string, string>)[h] || 'default'
}

function resizeCrop(rect: CropRect, corner: string, p: { x: number; y: number }, ratio: number | null, W: number, H: number): CropRect {
  let x1 = rect.x, y1 = rect.y, x2 = rect.x + rect.width, y2 = rect.y + rect.height
  if (corner.includes('w')) x1 = Math.min(p.x, x2 - 16)
  if (corner.includes('e')) x2 = Math.max(p.x, x1 + 16)
  if (corner.includes('n')) y1 = Math.min(p.y, y2 - 16)
  if (corner.includes('s')) y2 = Math.max(p.y, y1 + 16)
  if (ratio) {
    // Keep the ratio by deriving the dimension the user isn't dragging from
    // the one they are; anchor on the opposite side.
    const w = x2 - x1, h = y2 - y1
    const horizontal = corner === 'w' || corner === 'e'
    if (horizontal || (!['n', 's'].includes(corner) && w / h > ratio)) {
      const nh = w / ratio
      if (corner.includes('n')) y1 = y2 - nh; else y2 = y1 + nh
    } else {
      const nw = h * ratio
      if (corner.includes('w')) x1 = x2 - nw; else x2 = x1 + nw
    }
  }
  return clampCrop({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, W, H)
}

// ---------------------------------------------------------------------------
// Small UI bits

function ToolTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 h-7 rounded-full text-[11px] font-mono transition-colors ${
        active ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}>
      <Icon size={13} weight={active ? 'fill' : 'regular'} /> {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{title}</div>
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, onChange, format, resettable, hint }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
  format?: (v: number) => string; resettable?: boolean; hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-foreground/80">{label}</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {hint && <span className="text-muted-foreground/40">{hint}</span>}
          <span className="tabular-nums w-10 text-right">{format ? format(value) : value > 0 && min < 0 ? `+${value}` : value}</span>
          {resettable && value !== 0 && (
            <button onClick={() => onChange(0)} aria-label={`Reset ${label}`} className="hover:text-foreground">
              <ArrowCounterClockwise size={11} />
            </button>
          )}
        </span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => resettable && onChange(0)}
        className="w-full accent-[#aec3d2]" />
    </div>
  )
}
