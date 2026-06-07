'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, CircleNotch } from '@phosphor-icons/react'

interface NewProjectCardProps {
  onCreated?: () => void
}

export function NewProjectCard({ onCreated }: NewProjectCardProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled Project' })
      })
      
      if (res.ok) {
        const project = await res.json()
        onCreated?.()
        router.push(`/project/${project.id}`)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
    } finally {
      setCreating(false)
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={creating}
      className="group block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl text-left disabled:opacity-50"
      aria-label="Create new project"
    >
      <div className="glass glass-hover rounded-xl overflow-hidden aspect-[4/3] flex flex-col items-center justify-center gap-3 border border-dashed border-white/10 group-hover:border-accent/40 transition-colors duration-300 cursor-pointer">
        <div className="w-10 h-10 rounded-full flex items-center justify-center glass accent-glow group-hover:scale-110 transition-transform duration-300 border border-accent/30">
          {creating ? (
            <CircleNotch size={20} weight="thin" className="text-accent animate-spin" />
          ) : (
            <Plus size={20} weight="thin" className="text-accent" />
          )}
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span
            className="text-sm text-foreground/80 group-hover:text-accent transition-colors duration-200"
            style={{ fontFamily: 'var(--font-montserrat)' }}
          >
            {creating ? 'Creating...' : 'New Project'}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground tracking-wide">
            Start from canvas
          </span>
        </div>
      </div>
    </button>
  )
}
