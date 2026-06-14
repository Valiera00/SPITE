'use client'

import { Position, NodeProps, Handle, useReactFlow, useStore } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { ArrowsInSimple, Image as ImageIcon, CircleNotch, CheckCircle, UploadSimple } from '@phosphor-icons/react'
import { memo, useState, useEffect, useRef, useCallback } from 'react'
import { NodeActionToolbar } from './node-toolbar'
import { encodeScaled, autoFitUnderBytes, formatBytes, KLING_MAX_BYTES } from '@/lib/image-compress'

function CompressNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const { setNodes, getNodes } = useReactFlow()

  // Resolve the upstream image whenever the edges change.
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
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const [sourceInfo, setSourceInfo] = useState<{ width: number; height: number; bytes: number } | null>(null)

  const [scalePct, setScalePct] = useState<number>((data.scalePct as number) || 100)
  const [quality, setQuality] = useState<number>((data.quality as number) || 82)
  const [resultBytes, setResultBytes] = useState<number | null>((data.compressedBytes as number) || null)
  const [resultDims, setResultDims] = useState<{ width: number; height: number } | null>(null)

  const [status, setStatus] = useState<'idle' | 'compressing' | 'saving' | 'saved' | 'error'>(
    data.outputUrl ? 'saved' : 'idle',
  )
  const [errorMsg, setErrorMsg] = useState('')

  const outputUrl = data.outputUrl as string | undefined
  const fileInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A stable id for the current source, so we can tell a genuinely NEW image
  // from a remount of the same one. This is what stops the node recompressing
  // every time it scrolls back into view.
  const sourceKey = uploadedFile
    ? `upload:${uploadedFile.name}:${uploadedFile.size}`
    : (connectedUrl || '')
  const hasSource = !!sourceKey
  const previewSrc = uploadedPreview || connectedUrl || outputUrl || null

  // Lazily load + decode the source only when we actually need to (re)compress.
  const loadBitmap = useCallback(async (): Promise<ImageBitmap | null> => {
    if (bitmapRef.current) return bitmapRef.current
    const useFile = uploadedFile
    if (!useFile && !connectedUrl) return null
    try {
      const blob = useFile ? useFile : await (await fetch(connectedUrl!)).blob()
      const bmp = await createImageBitmap(blob)
      bitmapRef.current = bmp
      setSourceInfo({ width: bmp.width, height: bmp.height, bytes: blob.size })
      return bmp
    } catch (err) {
      console.error('[compress] failed to load source:', err)
      setErrorMsg('Could not read that image. Try uploading it into the node directly.')
      return null
    }
  }, [uploadedFile, connectedUrl])

  const uploadBlob = useCallback(async (blob: Blob): Promise<string | null> => {
    try {
      const filename = `compressed-${Date.now()}.jpg`
      const presignRes = await fetch('/api/r2-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType: 'image/jpeg' }),
      })
      if (!presignRes.ok) return null
      const { presignedUrl, proxyUrl } = await presignRes.json() as { presignedUrl: string; proxyUrl: string }
      const putRes = await fetch(presignedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
      if (!putRes.ok) return null
      await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: proxyUrl, type: 'image', filename, projectId }),
      })
      return proxyUrl
    } catch (err) {
      console.error('[compress] upload failed:', err)
      return null
    }
  }, [projectId])

  // Compress (auto-fit or explicit scale/quality) then save to R2 and persist.
  const compressAndSave = useCallback(async (opts: { autoFit: boolean; scale?: number; quality?: number }) => {
    const bmp = await loadBitmap()
    if (!bmp) return
    setErrorMsg('')
    setStatus('compressing')
    try {
      let blob: Blob, width: number, height: number, sUsed: number, qUsed: number
      if (opts.autoFit) {
        const r = await autoFitUnderBytes(bmp, KLING_MAX_BYTES)
        blob = r.blob; width = r.width; height = r.height
        sUsed = Math.round(r.scale * 100); qUsed = Math.round(r.quality * 100)
        setScalePct(sUsed); setQuality(qUsed)
      } else {
        sUsed = opts.scale ?? scalePct
        qUsed = opts.quality ?? quality
        const r = await encodeScaled(bmp, sUsed / 100, qUsed / 100)
        blob = r.blob; width = r.width; height = r.height
      }
      setResultBytes(blob.size)
      setResultDims({ width, height })
      setStatus('saving')
      const proxyUrl = await uploadBlob(blob)
      if (!proxyUrl) { setStatus('error'); setErrorMsg('Save failed — adjust to retry.'); return }
      setNodes((ns) => ns.map((n) => n.id === id ? {
        ...n,
        data: { ...n.data, outputUrl: proxyUrl, thumbnail: proxyUrl, scalePct: sUsed, quality: qUsed, compressedBytes: blob.size, sourceKey },
      } : n))
      setStatus('saved')
    } catch (err) {
      console.error('[compress] compress/save failed:', err)
      setStatus('error'); setErrorMsg('Compression failed.')
    }
  }, [loadBitmap, uploadBlob, scalePct, quality, id, setNodes, sourceKey])

  // Auto-fit to 10 MB the moment a NEW source connects — but never on a remount
  // of a source we've already compressed (sourceKey matches what's saved).
  useEffect(() => {
    if (!sourceKey) return
    if (sourceKey === data.sourceKey && data.outputUrl) {
      setStatus('saved')
      return
    }
    compressAndSave({ autoFit: true })
    // Run only when the source identity changes; compressAndSave is intentionally
    // excluded so a state change mid-compress doesn't retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  // Manual slider adjustment → debounced recompress + autosave. This is the only
  // path (besides a new connection / Fit button) that recompresses.
  const onAdjust = (kind: 'scale' | 'quality', value: number) => {
    if (kind === 'scale') setScalePct(value); else setQuality(value)
    const s = kind === 'scale' ? value : scalePct
    const q = kind === 'quality' ? value : quality
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      compressAndSave({ autoFit: false, scale: s, quality: q })
    }, 600)
  }

  const onPickFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    if (uploadedPreview) URL.revokeObjectURL(uploadedPreview)
    bitmapRef.current = null
    setUploadedPreview(URL.createObjectURL(file))
    setUploadedFile(file)
  }

  useEffect(() => {
    return () => {
      if (uploadedPreview) URL.revokeObjectURL(uploadedPreview)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const overLimit = resultBytes != null && resultBytes > KLING_MAX_BYTES
  const statusLabel =
    status === 'compressing' ? 'Compressing…' :
    status === 'saving' ? 'Saving…' :
    status === 'saved' ? 'Saved' :
    status === 'error' ? '' : ''

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

      <div className="absolute -top-8 left-0 flex items-center gap-2 z-10">
        <ArrowsInSimple size={12} className="text-accent" />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[200px]">
          {(data.label as string) || 'Compress'}
        </span>
      </div>

      <Handle type="target" id="image-in" position={Position.Left} style={{ top: '50%', left: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }} />
      <Handle type="source" id="image-out" position={Position.Right} style={{ top: '50%', right: -12, width: 24, height: 24, transform: 'translateY(-50%)', opacity: 0, zIndex: 5 }} />
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

      <div
        className="rounded-xl overflow-hidden"
        style={{
          width: 280,
          background: '#0D0F12',
          border: selected ? '1.5px solid rgba(107,143,168,0.85)' : '1.5px solid rgba(107,143,168,0.25)',
        }}
      >
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />

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
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>Original</span>
                <span>{sourceInfo ? `${sourceInfo.width}×${sourceInfo.height} · ${formatBytes(sourceInfo.bytes)}` : '—'}</span>
              </div>

              <label className="nodrag flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
                  <span>Scale</span><span>{scalePct}%</span>
                </div>
                <input type="range" min={10} max={100} step={5} value={scalePct}
                  onChange={(e) => onAdjust('scale', Number(e.target.value))}
                  className="nodrag w-full accent-[#aec3d2]" />
              </label>

              <label className="nodrag flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80">
                  <span>Quality</span><span>{quality}%</span>
                </div>
                <input type="range" min={40} max={95} step={1} value={quality}
                  onChange={(e) => onAdjust('quality', Number(e.target.value))}
                  className="nodrag w-full accent-[#aec3d2]" />
              </label>

              <div
                className="flex items-center justify-between text-[10px] font-mono px-2 py-1.5 rounded-md"
                style={{ background: overLimit ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.10)' }}
              >
                <span className={overLimit ? 'text-red-300' : 'text-green-300'}>
                  {resultBytes != null
                    ? `→ ${formatBytes(resultBytes)}${resultDims ? ` · ${resultDims.width}×${resultDims.height}` : ''}`
                    : '—'}
                </span>
                {resultBytes != null && (
                  <span className={overLimit ? 'text-red-300' : 'text-green-300'}>
                    {overLimit ? 'over 10 MB' : 'under 10 MB ✓'}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  className="nodrag text-[10px] font-mono px-2.5 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-foreground/80 transition-colors disabled:opacity-40"
                  onClick={() => compressAndSave({ autoFit: true })}
                  disabled={status === 'compressing' || status === 'saving'}
                >
                  Fit 10 MB
                </button>
                <span className="text-[10px] font-mono flex items-center gap-1.5">
                  {(status === 'compressing' || status === 'saving') && (
                    <><CircleNotch size={11} className="animate-spin text-accent" /><span className="text-accent">{statusLabel}</span></>
                  )}
                  {status === 'saved' && (
                    <><CheckCircle size={11} weight="fill" className="text-green-400" /><span className="text-green-400/80">{statusLabel}</span></>
                  )}
                </span>
              </div>

              {errorMsg && <span className="text-[9px] font-mono text-red-400/80">{errorMsg}</span>}
            </div>
          </>
        )}

        <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.04]">
          <span className="text-[10px] font-mono text-muted-foreground truncate">{(data.label as string) || 'compress'}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">FIT</span>
        </div>
      </div>
    </div>
  )
}

export const CompressNode = memo(CompressNodeImpl)
CompressNode.displayName = 'CompressNode'
