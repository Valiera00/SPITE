'use client'

import { Sparkle } from '@phosphor-icons/react'

export default function MobileCreate() {
  return (
    <div className="p-4 flex flex-col items-center justify-center text-center gap-3 pt-24">
      <Sparkle size={36} className="text-accent/70" />
      <h1 className="text-lg font-mono tracking-wide">Create</h1>
      <p className="text-sm font-mono text-muted-foreground max-w-xs">
        Generate from your phone — model, prompt, references, cost estimate. Coming next.
      </p>
    </div>
  )
}
