'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from '@phosphor-icons/react'

type Project = {
  id: string
  name: string
  thumbnail: string | null
  updatedat: string
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const s = Math.max(0, (Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 30) return `${Math.floor(d)}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export default function MobileProjects() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function newProject() {
    const name = window.prompt('New project name')?.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, origin: 'flow' }),
      })
      const proj = await res.json().catch(() => ({}))
      if (res.ok && proj?.id) router.push(`/m/project/${proj.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-mono tracking-wide">Projects</h1>
          <span className="text-[9px] font-mono text-muted-foreground/40">{(process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev').slice(0, 7)}</span>
        </div>
        <button
          onClick={newProject}
          disabled={creating}
          className="flex items-center gap-1 text-accent text-sm font-mono px-3 py-1.5 rounded-lg border border-white/10 bg-[#0D0F12] disabled:opacity-50 active:scale-[0.97] transition-transform"
        >
          <Plus size={14} weight="bold" /> {creating ? '…' : 'New'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm font-mono text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm font-mono text-muted-foreground">No projects yet. Tap New to start.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/m/project/${p.id}`)}
              className="flex items-center gap-3 p-2 rounded-xl bg-[#0D0F12] border border-white/10 text-left active:scale-[0.99] transition-transform"
            >
              <div className="w-14 h-14 rounded-lg overflow-hidden bg-black/40 shrink-0 flex items-center justify-center">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-[9px] font-mono text-muted-foreground/40">—</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-mono truncate block">{p.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{timeAgo(p.updatedat)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
