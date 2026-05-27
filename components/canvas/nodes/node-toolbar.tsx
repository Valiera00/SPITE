'use client'

import { useState, useRef, useEffect } from 'react'
import { NodeToolbar, Position, useReactFlow } from '@xyflow/react'
import {
  Play,
  CaretDown,
  CaretUp,
  Wrench,
  Trash,
  CopySimple,
  ArrowSquareOut,
  DotsThree,
  Image as ImageIcon,
  FilmStrip,
  TextT,
  Upload,
  User,
  MapPin,
  Package,
  CaretRight,
} from '@phosphor-icons/react'

interface NodeActionToolbarProps {
  nodeId: string
  selected?: boolean
  onRun?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onMoveToPage?: (page: number) => void
  onQuickConnect?: (nodeType: string) => void
  onAddToFolder?: (type: 'character' | 'prop' | 'location') => void
  assetId?: string
  assetUrl?: string
}

const QUICK_CONNECT_OPTIONS = [
  { id: 'imageGen', label: 'Image Generator', icon: ImageIcon },
  { id: 'videoGen', label: 'Video Generator', icon: FilmStrip },
  { id: 'prompt', label: 'Create text', icon: TextT },
  { id: 'reference', label: 'Reference Asset', icon: Upload },
]

export function NodeActionToolbar({ 
  nodeId, 
  selected, 
  onRun, 
  onDelete, 
  onDuplicate, 
  onMoveToPage,
  onQuickConnect,
  onAddToFolder,
  assetId,
  assetUrl,
}: NodeActionToolbarProps) {
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [addToMenuOpen, setAddToMenuOpen] = useState(false)
  const { deleteElements, getNodes, setNodes, addNodes, addEdges } = useReactFlow()

  const handleDelete = () => {
    deleteElements({ nodes: [{ id: nodeId }] })
    onDelete?.()
  }

  const handleDuplicate = () => {
    const nodes = getNodes()
    const node = nodes.find(n => n.id === nodeId)
    if (node) {
      const newNode = {
        ...node,
        id: `${node.id}-copy-${Date.now()}`,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        selected: false,
      }
      addNodes(newNode)
    }
    onDuplicate?.()
  }

  const handleQuickConnect = (nodeType: string) => {
    const nodes = getNodes()
    const sourceNode = nodes.find(n => n.id === nodeId)
    if (sourceNode) {
      const newNodeId = `${nodeType}-${Date.now()}`
      const newNode = {
        id: newNodeId,
        type: nodeType,
        position: { x: sourceNode.position.x + 500, y: sourceNode.position.y },
        data: { label: `${nodeType} #${nodes.length + 1}` },
      }
      addNodes(newNode)
      
      // Auto-connect based on type
      let sourceHandle = 'image-out'
      let targetHandle = 'image-in'
      if (sourceNode.type === 'prompt') {
        sourceHandle = 'prompt-out'
        targetHandle = 'prompt-in'
      } else if (sourceNode.type === 'videoGen') {
        sourceHandle = 'video-out'
        targetHandle = 'video-in'
      }
      
      addEdges({
        id: `edge-${nodeId}-${newNodeId}`,
        source: nodeId,
        target: newNodeId,
        sourceHandle,
        targetHandle,
        style: { stroke: '#A855F7', strokeWidth: 2 },
        animated: true,
      })
    }
    setConnectMenuOpen(false)
    onQuickConnect?.(nodeType)
  }

  return (
    <NodeToolbar isVisible={selected} position={Position.Top} offset={12}>
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 rounded-full"
        style={{
          background: 'rgba(18,20,24,0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}
      >
        {/* Run button with dropdown */}
        <div className="relative">
          <div className="flex items-center">
            <ToolBtn icon={Play} label="Run" accent onClick={onRun} />
            <button
              onClick={() => { setRunMenuOpen(!runMenuOpen); setConnectMenuOpen(false); setCopyMenuOpen(false) }}
              className="flex items-center justify-center w-4 h-6 text-accent hover:text-accent-foreground transition-colors"
            >
              {runMenuOpen ? <CaretUp size={8} weight="bold" /> : <CaretDown size={8} weight="bold" />}
            </button>
          </div>
          {runMenuOpen && (
            <DropdownMenu onClose={() => setRunMenuOpen(false)}>
              <MenuItem label="Run once" onClick={() => { onRun?.(); setRunMenuOpen(false) }} />
              <MenuItem label="Run all connected" onClick={() => setRunMenuOpen(false)} />
              <MenuItem label="Run from here" onClick={() => setRunMenuOpen(false)} />
            </DropdownMenu>
          )}
        </div>

        <div className="w-px h-3.5 bg-white/10 mx-0.5" />

        {/* Quick connect with dropdown */}
        <div className="relative">
          <div className="flex items-center">
            <ToolBtn icon={Wrench} label="Quick connect" />
            <button
              onClick={() => { setConnectMenuOpen(!connectMenuOpen); setRunMenuOpen(false); setCopyMenuOpen(false) }}
              className="flex items-center justify-center w-4 h-6 text-muted-foreground hover:text-foreground transition-colors"
            >
              {connectMenuOpen ? <CaretUp size={8} weight="bold" /> : <CaretDown size={8} weight="bold" />}
            </button>
          </div>
          {connectMenuOpen && (
            <DropdownMenu onClose={() => setConnectMenuOpen(false)}>
              {QUICK_CONNECT_OPTIONS.map(opt => (
                <MenuItem 
                  key={opt.id} 
                  label={opt.label} 
                  icon={opt.icon}
                  onClick={() => handleQuickConnect(opt.id)} 
                />
              ))}
            </DropdownMenu>
          )}
        </div>

        <div className="w-px h-3.5 bg-white/10 mx-0.5" />

        {/* Delete */}
        <ToolBtn icon={Trash} label="Delete" onClick={handleDelete} danger />

        {/* Copy with dropdown */}
        <div className="relative">
          <div className="flex items-center">
            <ToolBtn icon={CopySimple} label="Copy" onClick={handleDuplicate} />
            <button
              onClick={() => { setCopyMenuOpen(!copyMenuOpen); setRunMenuOpen(false); setConnectMenuOpen(false) }}
              className="flex items-center justify-center w-4 h-6 text-muted-foreground hover:text-foreground transition-colors"
            >
              {copyMenuOpen ? <CaretUp size={8} weight="bold" /> : <CaretDown size={8} weight="bold" />}
            </button>
          </div>
          {copyMenuOpen && (
            <DropdownMenu onClose={() => setCopyMenuOpen(false)}>
              <MenuItem label="Duplicate" onClick={() => { handleDuplicate(); setCopyMenuOpen(false) }} />
              <MenuItem label="Copy to clipboard" onClick={() => setCopyMenuOpen(false)} />
            </DropdownMenu>
          )}
        </div>

        {/* Move to page */}
        <ToolBtn icon={ArrowSquareOut} label="Move to page" onClick={() => onMoveToPage?.(2)} />

        <div className="w-px h-3.5 bg-white/10 mx-0.5" />

        {/* More options with Add to submenu */}
        <div className="relative">
          <ToolBtn 
            icon={DotsThree} 
            label="More options" 
            onClick={() => { 
              setMoreMenuOpen(!moreMenuOpen) 
              setRunMenuOpen(false)
              setConnectMenuOpen(false)
              setCopyMenuOpen(false)
            }} 
          />
          {moreMenuOpen && (
            <DropdownMenu onClose={() => { setMoreMenuOpen(false); setAddToMenuOpen(false) }}>
              {/* Add to submenu - only show if we have an asset */}
              {(assetId || assetUrl) && (
                <div className="relative">
                  <button
                    onMouseEnter={() => setAddToMenuOpen(true)}
                    className="flex items-center justify-between w-full px-3 py-1.5 text-left text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  >
                    <span>Add to...</span>
                    <CaretRight size={10} />
                  </button>
                  {addToMenuOpen && (
                    <div
                      className="absolute left-full top-0 ml-1 min-w-[140px] py-1 rounded-lg z-50"
                      style={{
                        background: 'rgba(18,20,24,0.98)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        backdropFilter: 'blur(12px)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      }}
                      onMouseLeave={() => setAddToMenuOpen(false)}
                    >
                      <MenuItem 
                        label="Character" 
                        icon={User} 
                        onClick={() => { onAddToFolder?.('character'); setMoreMenuOpen(false); setAddToMenuOpen(false) }} 
                      />
                      <MenuItem 
                        label="Location" 
                        icon={MapPin} 
                        onClick={() => { onAddToFolder?.('location'); setMoreMenuOpen(false); setAddToMenuOpen(false) }} 
                      />
                      <MenuItem 
                        label="Prop" 
                        icon={Package} 
                        onClick={() => { onAddToFolder?.('prop'); setMoreMenuOpen(false); setAddToMenuOpen(false) }} 
                      />
                    </div>
                  )}
                </div>
              )}
              <MenuItem label="View fullscreen" onClick={() => setMoreMenuOpen(false)} />
              <MenuItem label="Download" onClick={() => setMoreMenuOpen(false)} />
              <div className="h-px bg-white/10 my-1" />
              <MenuItem label="Copy prompt" onClick={() => setMoreMenuOpen(false)} />
              <MenuItem label="Prompt info" onClick={() => setMoreMenuOpen(false)} />
            </DropdownMenu>
          )}
        </div>
      </div>
    </NodeToolbar>
  )
}

function ToolBtn({
  icon: Icon,
  label,
  accent,
  danger,
  onClick,
}: {
  icon: React.ElementType
  label: string
  accent?: boolean
  danger?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
        accent
          ? 'bg-accent/20 text-accent hover:bg-accent hover:text-accent-foreground'
          : danger
          ? 'text-muted-foreground hover:text-red-400 hover:bg-red-400/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
      }`}
    >
      <Icon size={12} weight={accent ? 'fill' : 'regular'} />
    </button>
  )
}

function DropdownMenu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 min-w-[160px] py-1 rounded-lg z-50"
      style={{
        background: 'rgba(18,20,24,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
    >
      {children}
    </div>
  )
}

function MenuItem({ 
  label, 
  icon: Icon, 
  onClick 
}: { 
  label: string
  icon?: React.ElementType
  onClick?: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
    >
      {Icon && <Icon size={12} className="text-accent" />}
      {label}
    </button>
  )
}
