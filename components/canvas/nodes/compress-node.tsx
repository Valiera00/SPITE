'use client'

import { Position, NodeProps, Handle, useReactFlow, useStore } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { ArrowsInSimple, Image as ImageIcon, CircleNotch, CheckCircle, UploadSimple } from '@phosphor-icons/react'
import { memo, useState, useEffect, useRef } from 'react'
import { NodeActionToolbar } from './node-toolbar'
import { encodeScaled, autoFitUnderBytes, formatBytes, KLING_MAX_BYTES } from '@/lib/image-compress'

type SourceInfo = { width: number; height: number; bytes: number }
type Result = { bytes: number; width: number; height: number; url: string }

function CompressNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const { setNodes, getNodes } = useReactFlow()

  // Re-resolve the upstream image whenever the edges change so connecting a
  // reference node into image-in loads it automatically.
  const edges = useStore((s) => s.edges)
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null)
  useEffect(() => {
    const edge = edges.find(
      (e) => e.target === id && (e.targetHandle === 'image-in' || !e.targetHandle),
    )
    if (!edge) { setConnectedUrl(null); return }
    const src = getNodes().find((n) => n.id === edge.source)
    const url = (src?.data?.outputUrl || src?.data?.thumbnail) as string | undefined
    setConnectedUrl(url || null)
  }, [edges, id, getNodes])

  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null)
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)

  const [scalePct, setScalePct] = useState<number>((data.scalePct as number) || 100)
  const [quality, setQuality] = useState<number>((data.quality as number) || 82)
  const [result, setResult] = useState<Result | null>(null)
  const resultBlobRef = useRef<Blob | null>(null)

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ready' | 'error'>(
    data.outputUrl ? 'ready' : 'idle',
  )
  const [errorMsg, setErrorMsg] = useState('')

  const outputUrl = data.outputUrl as string | undefined
  const hasSource = !!uploadedFile || !!connectedUrl
  const previewSrc = uploadedPreview || connectedUrl

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load the chosen source (uploaded file wins over a connection) into an
  // ImageBitmap so we can downscale it. Connected URLs are fetched as a blob;
  // R2's CORS already permits this (the same crossOrigin path powers video
  // thumbnails), but if it's blocked we tell the user to upload directly.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const hasUpload = !!uploadedFile
      if (!hasUpload && !connectedUrl) {
        bitmapRef.current = null
        setSourceInfo(null)
        return
      }
      setBusy(true)
      setErrorMsg('')
      try {
        const blob = uploadedFile ? uploadedFile : await (await fetch(connectedUrl!)).blob()
        const bmp = await createImageBitmap(blob)
        if (cancelled) return
        bitmapRef.current = bmp
        setSourceInfo({ width: bmp.width, height: bmp.height, bytes: blob.size })
      } catch (err) {
        if (cancelled) return
        console.error('[compress] failed to load source:', err)
        setErrorMsg('Could not read that image. Try uploading it into the node directly.')
        setSourceInfo(null)
        bitmapRef.current = null
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [uploadedFile, connectedUrl])

  // Debounced compression preview whenever the source or the sliders change.
  useEffect(() => {
    if (!bitmapRef.current) return
    const t = setTimeout(async () => {
      try {
        setBusy(true)
        const { blob, width, height } = await encodeScaled(
          bitmapRef.current!, scalePct / 100, quality / 100,
        )
        resultBlobRef.current = blob
        setResult((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url)
          return { bytes: blob.size, width, height, url: URL.createObjectURL(blob) }
        })
      } catch (err) {
        console.error('[compress] encode failed:', err)
      } finally {
        setBusy(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [scalePct, quality, sourceInfo])

  // Clean up object URLs on unmount.
  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url)
      if (uploadedPreview) URL.revokeObjectURL(uploadedPreview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPickFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview)
    setUploadedPreview(URL.createObjectURL(file))
    setUploadedFile(file)
    setStatus('idle')
  }

  const handleAutoFit = async () => {
    if (!bitmapRef.current) return
    setBusy(true)
    try {
      const r = await autoFitUnderBytes(bitmapRef.current, KLING_MAX_BYTES)
      setScalePct(Math.round(r.scale * 100))
      setQuality(Math.round(r.quality * 100))
      resultBlobRef.current = r.blob
      setResult((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return { bytes: r.blob.size, width: r.width, height: r.height, url: URL.createObjectURL(r.blob) }
      })
    } catch (err) {
      console.error('[compress] auto-fit failed:', err)
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    const blob = resultBlobRef.current
    if (!blob) return
    setStatus('uploading')
    setErrorMsg('')
    try {
      const filename = `compressed-${Date.now()}.jpg`
      const presignRes = await fetch('/api/r2-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType: 'image/jpeg' }),
      })
      if (!presignRes.ok) throw new Error('presign failed')
      const { presignedUrl, proxyUrl } = await presignRes.json() as { presignedUrl: string; proxyUrl: string }

      const putRes = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      })
      if (!putRes.ok) throw new Error('upload failed')

      // Register so cleanup won't reap it, then expose as the node's output.
      await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: proxyUrl, type: 'image', filename, projectId }),
      })

      setNodes((ns) => ns.map((n) => n.id === id ? {
        ...n,
        data: { ...n.data, outputUrl: proxyUrl, thumbnail: proxyUrl, scalePct, quality, compressedBytes: blob.size },
      } : n))
      setStatus('ready')
    } catch (err) {
      console.error('[compress] apply failed:', err)
      setErrorMsg('Upload failed — try again.')
      setStatus('error')
    }
  }

  const overLimit = !!result && result.bytes > KLING_MAX_BYTES

  return (
    <div className="relative group">
      <NodeActionToolbar
        nodeId={id}
        selected={selected}
        nodeLabel={(data.label as string) || 'Compress'}
        assetId={data.assetId as string}
        assetUrl={outputUrl}
        assetType="image"
      />

      {/* Header */}
      <div className="absolute -top-8 left-0 flex items-center gap-2 z-10">
        <ArrowsInSimple size={12} className="text-accent" />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[200px]">
          {(data.label as string) || 'Compress'}
        </span>
      </div>

      {/* Handles: image in (left), compressed image out (right) */}
      <Handle type="target" id="image-in" position={Position.Left} style={{ top: '50%', left: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }} />
      <Handle type="source" id="image-out" position={Position.Right} style={{ top: '50%', right: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }} />
      {/* Visible input port (left) — drag an image node's output into here. */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          width: 24, height: 24, borderRadius: '50%', background: '#111316',
          border: `1.5px solid ${connectedUrl ? 'rgba(96,165,250,0.85)' : 'rgba(107,143,168,0.55)'}`,
          top: '50%', left: -12, transform: 'translateY(-50%)', zIndex: 10, pointerEvents: 'none',
        }}
      >
        <ImageIcon size={11} weight="bold" style={{ color: connectedUrl ? 'rgba(96,165,250,0.95)' : 'rgba(107,143,168,0.75)' }} />
      </div>
      {/* Visible output port (right) — wires the compressed image into a generator. */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          width: 24, height: 24, borderRadius: '50%', background: '#111316',
          border: `1.5px solid ${outputUrl ? 'rgba(96,165,250,0.85)' : 'rgba(96,165,250,0.3)'}`,
          top: '50%', right: -12, transform: 'translateY(-50%)', zIndex: 10, pointerEvents: 'none',
        }}
      >
        <ImageIcon size={11} weight="bold" style={{ color: outputUrl ? 'rgba(96,165,250,0.95)' : 'rgba(96,165,250,0.4)' }} />
      </div>

      {/* Card */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          width: 280,
          background: '#0D0F12',
          border: selected ? '1.5px solid rgba(107,143,168,0.85)' : '1.5px solid rgba(107,143,168,0.25)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />

        {!hasSource ? (
          <button
            className="nodrag w-full flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onPickFile(e.dataTransfer.files?.[0]) }}
          >
            <UploadSimple size={26} />
            <span className="text-[11px] font-mono">Connect an image or click to upload</span>
          </button>
        ) : (
          <>
            {previewSrc && (
              <div className="relative max-h-[140px] overflow-hidden bg-black/40 flex items-center justify-center">
                <img src={previewSrc} alt="" className="w-full h-auto object-contain max-h-[140px]" loading="lazy" decoding="async" />
              </div>
            )}

            <div className="px-3 py-2.5 flex flex-col gap-2.5">
              {/* Original */}
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>Original</span>
                <span>
                  {sourceInfo ? `${sourceInfo.width}×${sourceInfo.height} · ${formatBytes(sourceInfo.bytes)}` : (busy ? 'reading…' : '—')}
                </span>
              </div>

              {/* Scale */}
              <label className="nodrag flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
                  <span>Scale</span><span>{scalePct}%</span>
                </div>
                <input
                  type="range" min={10} max={100} step={5} value={scalePct}
                  onChange={(e) => setScalePct(Number(e.target.value))}
                  className="nodrag w-full accent-[#aec3d2]"
                />
              </label>

              {/* Quality */}
              <label className="nodrag flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
                  <span>Quality</span><span>{quality}%</span>
                </div>
                <input
                  type="range" min={40} max={95} step={1} value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="nodrag w-full accent-[#aec3d2]"
                />
              </label>

              {/* Result */}
              <div
                className="flex items-center justify-between text-[10px] font-mono px-2 py-1.5 rounded-md"
                style={{ background: overLimit ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.10)' }}
              >
                <span className={overLimit ? 'text-red-300' : 'text-green-300'}>
                  {busy && !result ? 'compressing…' : result ? `→ ${formatBytes(result.bytes)} · ${result.width}×${result.height}` : '—'}
                </span>
                {result && (
                  <span className={overLimit ? 'text-red-300' : 'text-green-300'}>
                    {overLimit ? 'over 10 MB' : 'under 10 MB ✓'}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  className="nodrag flex-1 text-[10px] font-mono py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-foreground/80 transition-colors disabled:opacity-40"
                  onClick={handleAutoFit}
                  disabled={busy || !sourceInfo}
                >
                  Fit 10 MB
                </button>
                <button
                  className="nodrag flex-1 text-[10px] font-mono py-1.5 rounded-md bg-accent/20 hover:bg-accent/30 text-accent transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                  onClick={handleApply}
                  disabled={busy || !result || overLimit || status === 'uploading'}
                >
                  {status === 'uploading'
                    ? <><CircleNotch size={11} className="animate-spin" /> Saving</>
                    : status === 'ready'
                      ? <><CheckCircle size={11} weight="fill" /> Ready</>
                      : 'Use this'}
                </button>
              </div>

              {status === 'ready' && (
                <span className="text-[9px] font-mono text-green-400/70">
                  Compressed image wired to the output — connect it to your generator.
                </span>
              )}
              {errorMsg && (
                <span className="text-[9px] font-mono text-red-400/80">{errorMsg}</span>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.04]">
          <span className="text-[10px] font-mono text-muted-foreground truncate">
            {(data.label as string) || 'compress'}
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">FIT</span>
        </div>
      </div>
    </div>
  )
}

export const CompressNode = memo(CompressNodeImpl)
CompressNode.displayName = 'CompressNode'
