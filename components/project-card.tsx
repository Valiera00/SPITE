'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { FilmSlate, ClockCounterClockwise, DotsThreeVertical, CopySimple, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

interface ProjectCardProps {
  id: string
  name: string
  thumbnail?: string
  lastModified: string
  genre?: string
  onMutate?: () => void
}

export function ProjectCard({ id, name, thumbnail, lastModified, genre, onMutate }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const stopNav = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDuplicate = async () => {
    if (duplicating) return
    setMenuOpen(false)
    setDuplicating(true)
    try {
      const res = await fetch(`/api/projects/${id}/duplicate`, { method: 'POST' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      toast.success('Project duplicated')
      onMutate?.()
    } catch (err) {
      console.error('[project-card] duplicate failed:', err)
      toast.error('Failed to duplicate project')
    } finally {
      setDuplicating(false)
    }
  }

  const handleDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      toast.success('Project deleted')
      onMutate?.()
      setConfirmOpen(false)
      setConfirmText('')
    } catch (err) {
      console.error('[project-card] delete failed:', err)
      toast.error('Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  // Failsafe: require the user to type the project name exactly to confirm
  // deletion. Trimmed, case-sensitive — matches typical "type to confirm" UX.
  const canConfirmDelete = confirmText.trim() === name.trim() && !deleting

  return (
    <>
      <Link
        href={`/project/${id}`}
        className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        <article className="relative glass glass-hover rounded-xl overflow-hidden cursor-pointer">
          {/* Hover menu trigger */}
          <div
            ref={menuRef}
            className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={stopNav}
            onMouseDown={stopNav}
          >
            <button
              onClick={(e) => { stopNav(e); setMenuOpen(v => !v) }}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80 border border-white/10 text-white/80 hover:text-white backdrop-blur transition-colors"
              aria-label="Project options"
              title="Options"
            >
              <DotsThreeVertical size={14} weight="bold" />
            </button>
            {menuOpen && (
              <div
                className="absolute top-full right-0 mt-1 w-40 py-1 rounded-lg z-20"
                style={{
                  background: 'rgba(18,20,24,0.98)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
              >
                <button
                  onClick={(e) => { stopNav(e); handleDuplicate() }}
                  disabled={duplicating}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  <CopySimple size={12} className="text-accent" />
                  {duplicating ? 'Duplicating…' : 'Duplicate'}
                </button>
                <button
                  onClick={(e) => { stopNav(e); setMenuOpen(false); setConfirmOpen(true) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400/90 hover:text-red-300 hover:bg-red-400/10 transition-colors"
                >
                  <Trash size={12} />
                  Delete…
                </button>
              </div>
            )}
          </div>

          {/* Thumbnail */}
          <div className="relative w-full aspect-video overflow-hidden bg-[#0D0F12] dot-grid">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={`${name} thumbnail`}
                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-300"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <FilmSlate
                  size={36}
                  weight="thin"
                  className="text-white/20 group-hover:text-white/30 transition-colors duration-300"
                />
              </div>
            )}
            {/* Cinematic letterbox overlay */}
            <div className="absolute inset-x-0 top-0 h-[6px] bg-black/60" />
            <div className="absolute inset-x-0 bottom-0 h-[6px] bg-black/60" />
            {/* Genre tag */}
            {genre && (
              <div className="absolute top-3 right-3">
                <span className="text-[9px] tracking-widest uppercase px-2 py-0.5 rounded-full glass border border-accent/30 text-accent/80">
                  {genre}
                </span>
              </div>
            )}
          </div>

          {/* Card footer */}
          <div className="px-4 py-3 flex flex-col gap-1 border-t border-white/5">
            <h3
              className="text-base leading-snug text-foreground truncate group-hover:text-accent transition-colors duration-200"
              style={{ fontFamily: 'var(--font-dm-serif)' }}
            >
              {name}
            </h3>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ClockCounterClockwise size={11} weight="thin" />
              <time className="text-[10px] tracking-wide">{lastModified}</time>
            </div>
          </div>
        </article>
      </Link>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o)
          if (!o) setConfirmText('')
        }}
      >
        <AlertDialogContent
          className="bg-[#0E1014] border border-white/10"
          onClick={stopNav}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="text-foreground font-medium">{name}</span> and its canvas. Generated assets in your library are kept.
              <br />
              Type the project name to confirm — this can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={name}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirmDelete) handleDelete()
            }}
            className="w-full h-10 px-3 rounded-md bg-black/40 border border-white/10 outline-none text-sm text-foreground placeholder:text-muted-foreground/40 focus:border-red-400/40"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!canConfirmDelete}
              className="bg-red-500 hover:bg-red-600 text-white disabled:bg-red-500/30 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
