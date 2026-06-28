'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkle, FolderSimple, FilmSlate } from '@phosphor-icons/react'

// Mobile companion shell. A separate, touch-first set of routes under /m that
// reuse the same APIs, auth, and R2/Neon backend as the desktop canvas — no
// node graph, just a clean feed. Open spite.run/m on a phone.
const TABS = [
  { href: '/m/create', label: 'Create', icon: Sparkle },
  { href: '/m/library', label: 'Library', icon: FolderSimple },
  { href: '/m', label: 'Projects', icon: FilmSlate },
]

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="min-h-screen flex flex-col bg-[#080A0C] text-[#F0EDE6]">
      <div className="flex-1 overflow-y-auto pb-20">{children}</div>
      <nav className="fixed bottom-0 inset-x-0 z-50 h-16 flex bg-[#0D0F12]/95 border-t border-white/10 backdrop-blur">
        {TABS.map((t) => {
          // "/m" matches only exactly (Projects home); the others match by prefix.
          const active = t.href === '/m' ? pathname === '/m' : pathname.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${
                active ? 'text-accent' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={22} weight={active ? 'fill' : 'regular'} />
              <span className="text-[10px] font-mono">{t.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
