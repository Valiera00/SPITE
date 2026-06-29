'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderSimple, FilmSlate } from '@phosphor-icons/react'

// Flow-mode shell (served under /m; phone bookmarks keep working). Project-first,
// thread-based (Krea-style): the Projects list is the home, and tapping into a
// project opens an immersive generation thread with its own compose bar (so the
// tab bar is hidden there).
const TABS = [
  { href: '/m', label: 'Projects', icon: FilmSlate },
  { href: '/m/library', label: 'Library', icon: FolderSimple },
]

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const inThread = pathname.startsWith('/m/project/')

  return (
    <div className="min-h-screen flex flex-col bg-[#080A0C] text-[#F0EDE6]">
      <div className={`flex-1 ${inThread ? '' : 'overflow-y-auto pb-20'}`}>{children}</div>
      {!inThread && (
        <nav className="fixed bottom-0 inset-x-0 z-50 h-16 flex bg-[#0D0F12]/95 border-t border-white/10 backdrop-blur">
          {TABS.map((t) => {
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
      )}
    </div>
  )
}
