'use client'

import { useEffect, useRef, useState } from 'react'
import {
  TextT,
  ImageSquare,
  FilmSlate,
  Robot,
  ArrowFatLineUp,
  Stack,
  MagnifyingGlass,
  FrameCorners,
  Sliders,
  Bag,
} from '@phosphor-icons/react'

export type NodeMenuItem = {
  id: string
  label: string
  shortcut: string
  icon: React.ElementType
  category: string
  nodeType: string
}

const ITEMS: NodeMenuItem[] = [
  { id: 'text',      label: 'Text',             shortcut: 'T', icon: TextT,          category: 'BASICS', nodeType: 'prompt'    },
  { id: 'image-gen', label: 'Image Generator',  shortcut: 'N', icon: ImageSquare,    category: 'BASICS', nodeType: 'imageGen'  },
  { id: 'video-gen', label: 'Video Generator',  shortcut: 'K', icon: FilmSlate,      category: 'BASICS', nodeType: 'videoGen'  },
  { id: 'assistant', label: 'Assistant',         shortcut: 'A', icon: Robot,          category: 'BASICS', nodeType: 'prompt'    },
  { id: 'upload',    label: 'Upload',            shortcut: 'U', icon: ArrowFatLineUp, category: 'MEDIA',  nodeType: 'reference' },
  { id: 'assets',    label: 'Assets',            shortcut: '',  icon: Stack,          category: 'MEDIA',  nodeType: 'reference' },
  { id: 'stock',     label: 'Stock',             shortcut: '',  icon: MagnifyingGlass,category: 'MEDIA',  nodeType: 'reference' },
  { id: 'frame',     label: 'Frame',             shortcut: 'F', icon: FrameCorners,   category: 'MODIFIERS', nodeType: 'prompt' },
  { id: 'txt-mod',   label: 'Text Modifier',     shortcut: 'M', icon: Sliders,        category: 'MODIFIERS', nodeType: 'prompt' },
  { id: 'cam-bag',   label: 'Camera Bag Style',  shortcut: 'C', icon: Bag,            category: 'MODIFIERS', nodeType: 'prompt' },
]

const CATEGORIES = ['BASICS', 'MEDIA', 'MODIFIERS']

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  BASICS: Stack,
  MEDIA: ImageSquare,
  MODIFIERS: Sliders,
}

interface AddNodeMenuProps {
  x: number
  y: number
  onSelect: (item: NodeMenuItem) => void
  onClose: () => void
}

export function AddNodeMenu({ x, y, onSelect, onClose }: AddNodeMenuProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  const filtered = ITEMS.filter(item => {
    const matchSearch = search === '' || item.label.toLowerCase().includes(search.toLowerCase())
    const matchCat = !activeCategory || item.category === activeCategory
    return matchSearch && matchCat
  })

  const grouped = CATEGORIES.reduce<Record<string, NodeMenuItem[]>>((acc, cat) => {
    const items = filtered.filter(i => i.category === cat)
    if (items.length) acc[cat] = items
    return acc
  }, {})

  return (
    <div
      ref={menuRef}
      className="fixed z-50 flex flex-col rounded-xl overflow-hidden"
      style={{
        left: x,
        top: y,
        width: 280,
        background: 'rgba(14,16,20,0.97)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
        <MagnifyingGlass size={12} weight="thin" className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search"
          className="flex-1 bg-transparent outline-none text-[12px] font-mono text-foreground placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Category icon tabs */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-white/[0.06]">
        <button
          onClick={() => setActiveCategory(null)}
          className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${!activeCategory ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
        >
          <Stack size={13} weight="regular" />
        </button>
        {CATEGORIES.map(cat => {
          const Icon = CATEGORY_ICONS[cat]
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${activeCategory === cat ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            >
              <Icon size={13} weight="regular" />
            </button>
          )
        })}
      </div>

      {/* Items */}
      <div className="overflow-y-auto max-h-[340px] py-1">
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div className="px-3 pt-3 pb-1">
              <span className="text-[9px] font-mono text-muted-foreground/50 tracking-widest uppercase">{cat}</span>
            </div>
            {items.map(item => (
              <button
                key={item.id}
                onClick={(e) => { 
                  e.stopPropagation()
                  onSelect(item)
                  onClose() 
                }}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors group"
              >
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/5 group-hover:bg-accent/20 group-hover:text-accent text-muted-foreground transition-colors shrink-0">
                  <item.icon size={13} weight="regular" />
                </div>
                <span className="flex-1 text-left text-[12px] font-mono text-foreground/80">{item.label}</span>
                {item.shortcut && (
                  <kbd className="text-[9px] font-mono text-muted-foreground/40 bg-white/5 px-1.5 py-0.5 rounded">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>
        ))}
        {Object.keys(grouped).length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground/40">No results</div>
        )}
      </div>

      {/* Footer shortcuts */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
          <kbd className="bg-white/5 px-1.5 py-0.5 rounded">N</kbd>
          <span>Open</span>
        </div>
        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
          <kbd className="bg-white/5 px-1.5 py-0.5 rounded">↑↓</kbd>
          <span>Navigate</span>
        </div>
        <div className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/40">
          <kbd className="bg-white/5 px-1.5 py-0.5 rounded">↵</kbd>
          <span>Insert</span>
        </div>
      </div>
    </div>
  )
}
