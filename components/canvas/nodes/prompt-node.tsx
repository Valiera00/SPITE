'use client'

import { memo, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Position, NodeProps, Handle, useReactFlow } from '@xyflow/react'
import { TextT } from '@phosphor-icons/react'
import { NodeActionToolbar } from './node-toolbar'
import { MentionTextarea, type Mention } from '../mention-textarea'
import { useProjectFolders } from '@/hooks/use-project-folders'

function HandleIcon({ icon: Icon, color, style }: { icon: React.ElementType; color: string; style?: React.CSSProperties }) {
  return (
    <div
      className="absolute flex items-center justify-center"
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: '#111316',
        border: `1.5px solid ${color}`,
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
        pointerEvents: 'none',
        ...style,
      }}
    >
      <Icon size={10} weight="bold" style={{ color }} />
    </div>
  )
}

function PromptNodeImpl({ id, data, selected }: NodeProps) {
  const params = useParams()
  const projectId = params.id as string | undefined
  const [text, setText] = useState((data.text as string) || '')
  const [mentions, setMentions] = useState<Mention[]>((data.mentions as Mention[]) || [])
  const { folders } = useProjectFolders(projectId)
  const { setNodes } = useReactFlow()

  // Sync text + mentions to node data so downstream image/video nodes can
  // resolve @Folder tags out of the compiled prompt.
  useEffect(() => {
    setNodes(nodes => nodes.map(n =>
      n.id === id ? { ...n, data: { ...n.data, text, mentions } } : n
    ))
  }, [text, mentions, id, setNodes])

  return (
    <div className="relative" style={{ width: 340 }}>
      <NodeActionToolbar nodeId={id} selected={selected} />

      {/* Node label */}
      <div className="absolute -top-6 left-0 text-[10px] font-mono text-muted-foreground/60 whitespace-nowrap pointer-events-none">
        {(data.label as string) || 'Prompt #1'}
      </div>

      {/* Output handle (card height ~170px) */}
      <Handle type="source" id="prompt-out" position={Position.Right} style={{ top: 85, right: 0, opacity: 0, width: 24, height: 24 }} />
      <HandleIcon icon={TextT} color="rgba(168,85,247,0.8)" style={{ top: 85, left: 340 }} />

      {/* Card content */}
      <div
        className="flex flex-col rounded-xl overflow-hidden transition-all duration-200"
        style={{
          background: '#0D0F12',
          border: selected ? '1.5px solid rgba(168,85,247,0.85)' : '1.5px solid rgba(168,85,247,0.25)',
          boxShadow: selected ? '0 0 0 1px rgba(168,85,247,0.2), 0 0 24px rgba(168,85,247,0.15)' : 'none',
        }}
      >
        <MentionTextarea
          value={text}
          mentions={mentions}
          onChange={(t, ms) => { setText(t); setMentions(ms) }}
          folders={folders}
          placeholder="Enter your prompt — type @ to reference a folder…"
          className="nodrag w-full bg-transparent resize-none outline-none text-[13px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed p-4 min-h-[160px] cursor-text"
          rows={6}
        />
      </div>
    </div>
  )
}

// React.memo skips re-renders when the props (id, data, selected, etc.)
// from React Flow are referentially equal. ReactFlow only swaps a node's
// `data` reference when *that* node's data is mutated, so unrelated changes
// to other nodes no longer re-render this one.
export const PromptNode = memo(PromptNodeImpl)
PromptNode.displayName = 'PromptNode'
