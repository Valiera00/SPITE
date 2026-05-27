'use client'

import Link from 'next/link'
import { FilmSlate, ClockCounterClockwise } from '@phosphor-icons/react'

interface ProjectCardProps {
  id: string
  name: string
  thumbnail?: string
  lastModified: string
  genre?: string
}

export function ProjectCard({ id, name, thumbnail, lastModified, genre }: ProjectCardProps) {
  return (
    <Link href={`/project/${id}`} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl">
      <article className="glass glass-hover rounded-xl overflow-hidden cursor-pointer">
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
              <span className="text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded-full glass border border-accent/30 text-accent/80">
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
            <time className="text-[10px] font-mono tracking-wide">{lastModified}</time>
          </div>
        </div>
      </article>
    </Link>
  )
}
