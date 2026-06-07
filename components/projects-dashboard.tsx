'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { ProjectCard } from './project-card'
import { NewProjectCard } from './new-project-card'
import { SearchBar } from './search-bar'

interface Project {
  id: string
  name: string
  description: string | null
  thumbnail: string | null
  createdat: string
  updatedat: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(data => {
  // Handle both array response and error response
  if (Array.isArray(data)) return data
  console.error('[projects-dashboard] API returned non-array:', data)
  return []
})

export function ProjectsDashboard() {
  const [search, setSearch] = useState('')
  const { data: projects = [], mutate } = useSWR<Project[]>('/api/projects', fetcher)

  const filtered = useMemo(() => {
    if (!search.trim()) return projects
    const q = search.toLowerCase()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    )
  }, [search, projects])

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    const diffWeeks = Math.floor(diffDays / 7)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
    if (diffWeeks < 4) return `${diffWeeks} week${diffWeeks !== 1 ? 's' : ''} ago`
    return date.toLocaleDateString()
  }

  const handleProjectCreated = () => {
    mutate()
  }

  return (
    <div className="min-h-screen bg-[#080A0C] dot-grid">
      <div className="min-h-screen bg-gradient-to-b from-[#080A0C] via-transparent to-[#080A0C]">
        {/* Header */}
        <header className="sticky top-0 z-50">
          <div className="glass border-b border-white/5 px-6 md:px-10 py-4">
            <div className="max-w-6xl mx-auto flex items-center justify-between gap-6">
              {/* Wordmark */}
              <div className="shrink-0">
                <img
                  src="/brand/icon-text/SPITE_text+icon_FLAT_WHITE.svg"
                  alt="SPITE"
                  className="h-8 w-auto select-none"
                  draggable={false}
                />
              </div>

              {/* Search */}
              <div className="flex-1 max-w-md">
                <SearchBar value={search} onChange={setSearch} />
              </div>

              {/* Slot — intentionally empty per spec */}
              <div className="shrink-0 w-[72px]" />
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-6xl mx-auto px-6 md:px-10 py-10">
          {/* Section label */}
          <div className="flex items-baseline justify-between mb-6">
            <p className="text-[11px] font-mono tracking-[0.18em] uppercase text-muted-foreground/70">
              {search ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''} for "${search}"` : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* New project card is always first */}
            {!search && <NewProjectCard onCreated={handleProjectCreated} />}

            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                id={project.id}
                name={project.name}
                thumbnail={project.thumbnail || undefined}
                lastModified={formatRelativeTime(project.updatedat)}
                onMutate={() => mutate()}
              />
            ))}

            {/* Empty state when searching */}
            {search && filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-24 gap-3">
                <p
                  className="text-xl text-foreground/40"
                  style={{ fontFamily: 'var(--font-montserrat)' }}
                >
                  No projects found
                </p>
                <p className="text-xs font-mono text-muted-foreground/50 tracking-wide">
                  Try a different search term
                </p>
              </div>
            )}

            {/* Empty state when no projects */}
            {!search && projects.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm text-muted-foreground/50 font-mono">
                  No projects yet. Create your first one!
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
