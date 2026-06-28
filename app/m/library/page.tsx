'use client'

import { FolderSimple } from '@phosphor-icons/react'

export default function MobileLibrary() {
  return (
    <div className="p-4 flex flex-col items-center justify-center text-center gap-3 pt-24">
      <FolderSimple size={36} className="text-accent/70" />
      <h1 className="text-lg font-mono tracking-wide">Library</h1>
      <p className="text-sm font-mono text-muted-foreground max-w-xs">
        Your Characters, Props, Locations and General assets — reference them into a prompt with one tap. Coming next.
      </p>
    </div>
  )
}
