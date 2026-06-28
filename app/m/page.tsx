'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Project = {
  id: string
  name: string
  thumbnail: string | null
  updatedat: string
}

export default function MobileProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-4">
      <h1 className="text-lg font-mono tracking-wide mb-4">Projects</h1>
      {loading ? (
        <p className="text-sm font-mono text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm font-mono text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/m/project/${p.id}`}
              className="rounded-xl overflow-hidden bg-[#0D0F12] border border-white/10 active:scale-[0.98] transition-transform"
            >
              <div className="aspect-video bg-black/40 flex items-center justify-center">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground/40">No preview</span>
                )}
              </div>
              <div className="px-2.5 py-2">
                <span className="text-xs font-mono truncate block">{p.name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
