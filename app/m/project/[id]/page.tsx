'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CaretLeft } from '@phosphor-icons/react'

type Asset = {
  id: string
  type: string
  r2_url: string
  prompt: string | null
  created_at: string
}

export default function MobileProjectFeed() {
  const params = useParams()
  const projectId = (params?.id as string) || ''
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    fetch(`/api/assets?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setAssets(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  return (
    <div className="p-4">
      <Link href="/m" className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground mb-3">
        <CaretLeft size={12} /> Projects
      </Link>
      <h1 className="text-lg font-mono tracking-wide mb-4">Feed</h1>
      {loading ? (
        <p className="text-sm font-mono text-muted-foreground">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm font-mono text-muted-foreground">No generations yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
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
      )}
    </div>
  )
}
