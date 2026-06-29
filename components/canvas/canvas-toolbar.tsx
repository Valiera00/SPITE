'use client'

import Link from 'next/link'
import { ArrowLeft, MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut, Lock, CheckCircle, Circle, GearSix, ListChecks } from '@phosphor-icons/react'
import { useReactFlow } from '@xyflow/react'
import { useState } from 'react'
import { useAuth } from '@/components/auth-provider'
import { FalBalanceBadge } from './fal-balance-badge'

interface CanvasToolbarProps {
  projectName: string
  onProjectNameChange: (name: string) => void
  saveStatus: 'saved' | 'unsaved'
  projectId: string
  // Right-side jobs panel: workspace owns the open/close state so the
  // panel persists across canvas interactions and the toolbar just
  // triggers the toggle.
  jobsPanelOpen?: boolean
  onToggleJobsPanel?: () => void
  activeJobCount?: number
}

export function CanvasToolbar({ projectName, onProjectNameChange, saveStatus, projectId, jobsPanelOpen, onToggleJobsPanel, activeJobCount = 0 }: CanvasToolbarProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const [editing, setEditing] = useState(false)
  const { logout } = useAuth()

  const handleLogout = () => {
    logout()
  }

  return (
    <div className="glass flex items-center justify-between px-4 h-12 shrink-0 relative z-10">
      {/* Left */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} weight="thin" />
        </Link>
        <div className="w-px h-4 bg-border" />
        {editing ? (
          <input
            autoFocus
            value={projectName}
            onChange={e => onProjectNameChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={e => e.key === 'Enter' && setEditing(false)}
            className="bg-transparent border-none outline-none text-foreground text-base tracking-tight"
            style={{ fontFamily: 'var(--font-montserrat)' }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-base tracking-tight text-foreground hover:text-accent transition-colors cursor-text"
            style={{ fontFamily: 'var(--font-montserrat)' }}
          >
            {projectName}
          </button>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => zoomIn({ duration: 200 })}
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom in"
        >
          <MagnifyingGlassPlus size={14} weight="thin" />
        </button>
        <button
          onClick={() => zoomOut({ duration: 200 })}
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
          title="Zoom out"
        >
          <MagnifyingGlassMinus size={14} weight="thin" />
        </button>
        <button
          onClick={() => fitView({ duration: 300, padding: 0.1 })}
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover text-muted-foreground hover:text-foreground transition-colors"
          title="Fit to screen"
        >
          <CornersOut size={14} weight="thin" />
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        <div className="flex items-center gap-1.5 text-[10px] font-mono tracking-wider text-muted-foreground select-none">
          {saveStatus === 'saved' ? (
            <CheckCircle size={11} weight="fill" className="text-accent/60" />
          ) : (
            <Circle size={11} weight="thin" className="text-muted-foreground/40" />
          )}
          <span className={saveStatus === 'saved' ? 'text-accent/60' : 'text-muted-foreground/40'}>
            {saveStatus === 'saved' ? 'Saved' : 'Unsaved'}
          </span>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Jobs panel toggle — only renders when the workspace wires
            it up (effectively always, but the prop is optional so the
            toolbar can render without it during early init). */}
        {onToggleJobsPanel && (
          <button
            data-tour="jobs-toggle"
            onClick={onToggleJobsPanel}
            className={`relative flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
              jobsPanelOpen
                ? 'bg-accent/20 text-accent'
                : 'glass-hover text-muted-foreground hover:text-foreground'
            }`}
            title={jobsPanelOpen ? 'Close jobs panel' : 'Open jobs panel'}
          >
            <ListChecks size={13} weight="thin" />
            {activeJobCount > 0 && !jobsPanelOpen && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse"
                title={`${activeJobCount} active job${activeJobCount === 1 ? '' : 's'}`}
              />
            )}
          </button>
        )}

        <FalBalanceBadge />

        <Link
          href="/settings"
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover transition-colors text-muted-foreground hover:text-foreground"
          title="Settings"
        >
          <GearSix size={13} weight="thin" />
        </Link>

        <button
          onClick={handleLogout}
          className="flex items-center justify-center w-7 h-7 rounded-lg glass-hover transition-colors ml-1 text-muted-foreground hover:text-destructive"
          title="Logout and lock canvas"
        >
          <Lock size={13} weight="thin" />
        </button>
      </div>
    </div>
  )
}
