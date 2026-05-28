'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  addEdge,
  SelectionMode,
  type NodeTypes,
  type EdgeTypes,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react'
import { ScissorsEdge } from './edges/scissors-edge'
import '@xyflow/react/dist/style.css'
import { useCanvasAutoSave } from '@/hooks/use-canvas-auto-save'
import { CanvasToolbar } from './canvas-toolbar'
import { LeftToolbar, type Asset, type AssetCategory } from './left-toolbar'
import { BottomBar } from './bottom-bar'
import { SceneTimeline, type Scene, type Shot } from './scene-timeline'
import { MapTrifold, X } from '@phosphor-icons/react'
import { AddNodeMenu } from './add-node-menu'
import { ImageNode } from './nodes/image-node'
import { VideoNode } from './nodes/video-node'
import { PromptNode } from './nodes/prompt-node'
import { ReferenceNode } from './nodes/reference-node'
import { CommentNode } from './nodes/comment-node'
import { StickerNode, getLastSticker } from './nodes/sticker-node'

const NODE_TYPES: NodeTypes = {
  imageGen: ImageNode,
  videoGen: VideoNode,
  prompt: PromptNode,
  reference: ReferenceNode,
  comment: CommentNode,
  sticker: StickerNode,
}

const EDGE_TYPES: EdgeTypes = {
  scissors: ScissorsEdge,
}

let nodeCount = 1
function makeId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

let sceneCount = 2  // Start at 2 since scene-1 exists
function makeSceneId() { return `scene-${sceneCount++}` }

let assetCount = 1
function makeAssetId() { return `asset-${assetCount++}` }

// Connection type validation rules
const CONNECTION_RULES: Record<string, string[]> = {
  'prompt-out': ['prompt-in'],
  'image-out': ['image-in', 'end-frame-in', 'reference-in'],
  'video-out': ['video-in'],
}

// Human-readable names for handles
const HANDLE_NAMES: Record<string, string> = {
  'prompt-out': 'Text output',
  'prompt-in': 'Text input',
  'image-out': 'Image output',
  'image-in': 'First frame / image input',
  'end-frame-in': 'End frame',
  'reference-in': 'Reference image',
  'video-out': 'Video output',
  'video-in': 'Video input',
}

// Validate connection rules
function isValidConnection(connection: Connection | Edge): boolean {
  const { sourceHandle, targetHandle } = connection
  if (!sourceHandle || !targetHandle) return false
  const allowedTargets = CONNECTION_RULES[sourceHandle]
  return allowedTargets?.includes(targetHandle) ?? false
}

// Get rejection reason for invalid connections
function getConnectionError(sourceHandle: string | null, targetHandle: string | null): string {
  if (!sourceHandle || !targetHandle) return 'Invalid connection'
  const sourceName = HANDLE_NAMES[sourceHandle] || sourceHandle
  const targetName = HANDLE_NAMES[targetHandle] || targetHandle
  return `Cannot connect ${sourceName} to ${targetName}`
}

function makeNode(type: string, position: { x: number; y: number }, label?: string, sceneId?: string) {
  const count = nodeCount++
  const labels: Record<string, string> = {
    imageGen: `Image Generator #${count}`,
    videoGen: `Video Generator #${count}`,
    prompt: `Prompt #${count}`,
    reference: `Reference Asset #${count}`,
    comment: '',
    sticker: '',
  }
  return {
    id: makeId(),
    type,
    position,
    data: { 
      label: label || labels[type] || type,
      sceneId: sceneId || 'scene-1',
      thumbnail: undefined as string | undefined,
      isUploading: false,
      uploadError: false,
    },
  }
}

// Initial demo data
const INITIAL_SCENES: Scene[] = [
  { id: 'scene-1', name: 'Scene 1', shots: [] },
]

const INITIAL_ASSETS: Asset[] = []

// Clipboard buffer — lives outside component so it persists across re-renders
let clipboardNodes: Node[] = []

// History for undo/redo
const MAX_HISTORY = 50

// Ghost sticker that follows the cursor during placement
function StickerGhost({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    const onLeave = () => setPos(null)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [containerRef])

  if (!pos) return null

  return (
    <div
      className="absolute pointer-events-none z-50 select-none"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -50%)',
        fontSize: 32,
        lineHeight: 1,
        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
      }}
    >
      {getLastSticker()}
    </div>
  )
}

function CanvasInner({ projectId }: { projectId: string }) {
  const [projectName, setProjectName] = useState('Untitled Project')
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  
  // Simple undo/redo using state
  const [past, setPast] = useState<{ nodes: Node[]; edges: Edge[] }[]>([])
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([])
  const skipHistoryRef = useRef(false)
  
  // Scene management
  const [scenes, setScenes] = useState<Scene[]>(INITIAL_SCENES)
  const [activeSceneId, setActiveSceneId] = useState('scene-1')
  
  // Asset management
  const [assets, setAssets] = useState<Asset[]>(INITIAL_ASSETS)
  
  // History panel state (for generations)
  const [showHistory, setShowHistory] = useState(false)
  
  // Active tool state
  const [activeTool, setActiveTool] = useState<'select' | 'cut' | 'sticker' | 'comment'>('select')

  // Auto-save hook
  const { saveCanvas, saveStatus } = useCanvasAutoSave(projectId, nodes, edges)

  // Load canvas data and assets on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load project details (including name)
        const projectResponse = await fetch(`/api/projects/${projectId}`)
        if (projectResponse.ok) {
          const project = await projectResponse.json()
          if (project.name) {
            setProjectName(project.name)
          }
        }

        // Load canvas
        const canvasResponse = await fetch(`/api/projects/${projectId}/canvas`)
        if (canvasResponse.ok) {
          const { nodes: savedNodes, edges: savedEdges } = await canvasResponse.json()
          if (savedNodes && savedEdges) {
            setNodes(savedNodes)
            setEdges(savedEdges)
          }
        }

        // Load assets
        const assetsResponse = await fetch(`/api/projects/${projectId}/assets`)
        if (assetsResponse.ok) {
          const loadedAssets = await assetsResponse.json()
          setAssets(loadedAssets)
        }
      } catch (error) {
        console.error('[v0] Error loading data:', error)
      }
    }

    loadData()
  }, [projectId, setNodes, setEdges])

  // Batch-generation nodes (image/video) ask the canvas to add edges that
  // mirror the original node's connections onto the spawned duplicates.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.edges?.length) {
        setEdges(es => {
          const existing = new Set(es.map(ed => ed.id))
          const toAdd = detail.edges.filter((ed: Edge) => !existing.has(ed.id))
          return [...es, ...toAdd]
        })
      }
    }
    window.addEventListener('frame-add-edges', handler as EventListener)
    return () => window.removeEventListener('frame-add-edges', handler as EventListener)
  }, [setEdges])

  // Save project name when it changes (debounced)
  const saveProjectNameRef = useRef<NodeJS.Timeout | null>(null)
  const handleProjectNameChange = (newName: string) => {
    setProjectName(newName)
    
    // Debounce the save
    if (saveProjectNameRef.current) {
      clearTimeout(saveProjectNameRef.current)
    }
    saveProjectNameRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        })
      } catch (error) {
        console.error('[v0] Error saving project name:', error)
      }
    }, 500)
  }

  // Derive shots from nodes that have a shotId assigned (tagged to a shot)
  const scenesWithShots = useMemo(() => {
    return scenes.map(scene => {
      const sceneNodes = (nodes as Node[]).filter(n => n.data.sceneId === scene.id)
      // Build a map of shot number -> node for tagged nodes
      const taggedNodes = sceneNodes.filter(n => n.data.shotId)
      const shotMap = new Map<number, Node>()
      for (const n of taggedNodes) {
        // shotId is like 'shot-1', 'shot-2', etc. Parse the number out.
        const match = String(n.data.shotId).match(/(\d+)$/)
        if (match) shotMap.set(parseInt(match[1]), n)
      }
      // Fill every slot from 1 to max with either a real shot or a placeholder
      const maxShot = shotMap.size > 0 ? Math.max(...shotMap.keys()) : 0
      const shots: Shot[] = []
      for (let i = 1; i <= maxShot; i++) {
        const n = shotMap.get(i)
        if (n) {
          shots.push({
            id: `shot-${n.id}`,
            nodeId: n.id,
            thumbnail: (n.data.outputUrl || n.data.thumbnail || n.data.assetUrl) as string | undefined,
            label: n.data.label as string,
            hasVideo: n.type === 'videoGen',
            order: i,
          })
        } else {
          // Placeholder for gap
          shots.push({
            id: `placeholder-${scene.id}-${i}`,
            nodeId: '',
            thumbnail: undefined,
            label: undefined,
            hasVideo: false,
            order: i,
          })
        }
      }
      return { ...scene, shots }
    })
  }, [scenes, nodes])

  const onConnect = useCallback((params: Connection) => {
    if (isValidConnection(params)) {
      setEdges((eds: Edge[]) => addEdge({
        ...params,
        animated: true,
      }, eds) as Edge[])
    } else {
      const error = getConnectionError(params.sourceHandle ?? null, params.targetHandle ?? null)
      toast.error(error, {
        description: 'These node types are not compatible',
        duration: 3000,
      })
    }
  }, [setEdges])
  
  const [minimapOpen, setMinimapOpen] = useState(true)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowPos: { x: number; y: number } } | null>(null)
  const { fitView, screenToFlowPosition, setCenter } = useReactFlow()
  const viewport = useViewport()
  const flowRef = useRef<HTMLDivElement>(null)

  const addNode = useCallback((type: string, flowPos?: { x: number; y: number }) => {
    const pos = flowPos || screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    setNodes((ns: Node[]) => [...ns, makeNode(type, pos, undefined, activeSceneId)] as Node[])
  }, [screenToFlowPosition, setNodes, activeSceneId])

  // Scene handlers
  const handleAddScene = useCallback(() => {
    const newScene: Scene = {
      id: makeSceneId(),
      name: `Scene ${scenes.length + 1}`,
      shots: [],
    }
    setScenes(s => [...s, newScene])
    setActiveSceneId(newScene.id)
  }, [scenes.length])

  // Asset handlers
  const handleSelectAsset = useCallback((asset: Asset) => {}, [])

  const [isDragOver, setIsDragOver] = useState(false)

  // Handle drag over canvas - accept both internal assets and desktop files
  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasAsset = e.dataTransfer.types.includes('asset')
    const hasFiles = e.dataTransfer.types.includes('Files')
    if (hasAsset || hasFiles) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (hasFiles) setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide overlay if leaving the canvas entirely
    if (!e.currentTarget.contains(e.relatedTarget as Element)) {
      setIsDragOver(false)
    }
  }, [])

  // Handle drop - desktop files or internal assets
  const handleDrop = useCallback((e: React.DragEvent) => {
    setIsDragOver(false)

    // Desktop file drop
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    )
    if (files.length > 0) {
      e.preventDefault()
      files.forEach((file, i) => {
        const pos = screenToFlowPosition({ x: e.clientX + i * 20, y: e.clientY + i * 20 })
        pasteImageFile(file, pos)
      })
      return
    }

    // Internal asset drop from assets panel
    const assetData = e.dataTransfer.getData('asset')
    if (!assetData) return

    try {
      const asset = JSON.parse(assetData)
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      
      // Create node for this asset
      const newNode: Node = {
        id: `ref-${Date.now()}`,
        type: 'reference',
        position: flowPos,
        data: {
          assetId: asset.id,
          thumbnail: asset.r2_url,
          label: asset.prompt || 'Reference',
          mediaType: asset.type === 'video' ? 'video' : 'image',
        },
      }
      
      setNodes((ns: Node[]) => [...ns, newNode] as Node[])
      
      // Mark asset as protected
      fetch(`/api/assets/${asset.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ used_in_canvas: true })
      }).then(() => {
        window.dispatchEvent(new CustomEvent('asset-status-changed'))
      }).catch(() => {})
    } catch (error) {
      console.error('[v0] Drop error:', error)
    }
  }, [screenToFlowPosition, setNodes])

  // Undo - restore previous state
  const undo = useCallback(() => {
    if (past.length === 0) return
    skipHistoryRef.current = true
    const previous = past[past.length - 1]
    const newPast = past.slice(0, -1)
    setFuture(f => [{ nodes, edges }, ...f])
    setPast(newPast)
    setNodes(previous.nodes as Node[])
    setEdges(previous.edges as Edge[])
  }, [past, nodes, edges, setNodes, setEdges])

  // Redo - restore future state
  const redo = useCallback(() => {
    if (future.length === 0) return
    skipHistoryRef.current = true
    const next = future[0]
    const newFuture = future.slice(1)
    setPast(p => [...p, { nodes, edges }])
    setFuture(newFuture)
    setNodes(next.nodes as Node[])
    setEdges(next.edges as Edge[])
  }, [future, nodes, edges, setNodes, setEdges])

  // Shot click - center on node
  const handleShotClick = useCallback((sceneId: string, shotId: string) => {
    const shot = scenesWithShots.find(s => s.id === sceneId)?.shots.find(sh => sh.id === shotId)
    if (shot) {
      const node = nodes.find(n => n.id === shot.nodeId)
      if (node) {
        setCenter(node.position.x + 200, node.position.y + 150, { zoom: 1, duration: 300 })
        // Select the node
        setNodes(ns => ns.map(n => ({ ...n, selected: n.id === node.id })))
      }
    }
  }, [scenesWithShots, nodes, setCenter, setNodes])

  // Track state changes for undo/redo
  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false
      return
    }
    // Push current state to past, clear future on any change
    setPast(p => [...p.slice(-49), { nodes, edges }]) // Max 50 history states
    setFuture([])
  }, [nodes, edges])

  // Delete selected nodes + their edges
  const deleteSelected = useCallback(() => {
    setNodes(ns => {
      const toDelete = ns.filter(n => n.selected)
      const selectedIds = new Set(toDelete.map(n => n.id))
      setEdges(es => es.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)))

      // Mark any linked assets as temporary (used_in_canvas = false)
      // Match by assetId if present, otherwise by thumbnail URL
      toDelete.forEach(n => {
        const assetId = n.data?.assetId as string | undefined
        const thumbnail = n.data?.thumbnail as string | undefined
        if (assetId) {
          fetch(`/api/assets/${assetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ used_in_canvas: false }),
          }).then(() => {
            window.dispatchEvent(new CustomEvent('asset-status-changed'))
          }).catch(() => {})
        } else if (thumbnail) {
          // Fallback: look up by URL then mark as temporary
          fetch(`/api/assets/by-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: thumbnail, used_in_canvas: false }),
          }).then(() => {
            window.dispatchEvent(new CustomEvent('asset-status-changed'))
          }).catch(() => {})
        }
      })

      return ns.filter(n => !n.selected)
    })
  }, [setNodes, setEdges])

  // Duplicate selected nodes with offset
  const duplicateSelected = useCallback(() => {
    setNodes(ns => {
      const selected = ns.filter(n => n.selected)
      if (!selected.length) return ns
      const copies = selected.map(n => ({
        ...n,
        id: makeId(),
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
        data: { ...n.data },
      }))
      // Deselect originals
      const deselected = ns.map(n => ({ ...n, selected: false }))
      return [...deselected, ...copies]
    })
  }, [setNodes])

  // Paste image file as reference node - uploads to R2 for persistence
  const pasteImageFile = useCallback(async (file: File, pos?: { x: number; y: number }) => {
    const flowPos = pos || screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const nodeLabel = file.name.replace(/\.[^.]+$/, '')
    const n = makeNode('reference', flowPos, nodeLabel, activeSceneId)
    
    // Create temp blob URL for immediate display
    const isVideoFile = file.type.startsWith('video/')
    const tempUrl = URL.createObjectURL(file)
    n.data = { ...n.data, thumbnail: tempUrl, isUploading: true, mediaType: isVideoFile ? 'video' : 'image' }
    setNodes(ns => [...ns, n])
    
    // Upload to R2 in background
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('filename', file.name)
      
      const uploadRes = await fetch('/api/r2-upload', { method: 'POST', body: formData })
      const uploadData = await uploadRes.json()
      
      if (uploadData.url) {
        // Convert direct R2 URL to proxy URL so it's accessible
        // R2 URL format: https://{bucket}.{accountId}.r2.dev/{key}
        // Proxy format: /api/r2-image/{key}
        const r2Key = uploadData.url.split('.r2.dev/')[1]
        const proxyUrl = r2Key ? `/api/r2-image/${r2Key}` : uploadData.url
        
        // Update node with proxy URL
        setNodes(ns => ns.map(node =>
          node.id === n.id
            ? { ...node, data: { ...node.data, thumbnail: proxyUrl, isUploading: false } }
            : node
        ))

        // Record in assets with proxy URL and mark as protected (used in canvas)
        const assetRes = await fetch('/api/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: proxyUrl, type: isVideoFile ? 'video' : 'image', filename: nodeLabel, projectId })
        })
        const assetData = await assetRes.json()
        console.log('[v0] Asset recorded:', { assetData, status: assetRes.status })
        
        // Asset is now recorded and protected (used_in_canvas = true)
        // Notify assets panel to refresh immediately
        window.dispatchEvent(new CustomEvent('asset-status-changed'))
        
        // Revoke temp blob URL
        URL.revokeObjectURL(tempUrl)
      } else {
        // Keep temp URL if upload fails - user can still work with it
      }
    } catch (error) {
      console.error('[v0] Failed to upload image:', error)
      // Keep temp URL if upload fails - user can still work with it
      setNodes(ns => ns.map(node => 
        node.id === n.id 
          ? { ...node, data: { ...node.data, isUploading: false, uploadError: true } }
          : node
      ))
    }
  }, [screenToFlowPosition, setNodes, activeSceneId])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const ctrl = e.ctrlKey || e.metaKey

      // Undo/Redo
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (ctrl && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      if (ctrl && e.key === 'y') { e.preventDefault(); redo() }

      // Node type shortcuts
      if (ctrl && e.key === 'n') { e.preventDefault(); addNode('imageGen') }
      if (ctrl && e.key === 'k') { e.preventDefault(); addNode('videoGen') }
      if (ctrl && e.key === 't') { e.preventDefault(); addNode('prompt') }
      if (ctrl && e.key === 'r') { e.preventDefault(); addNode('reference') }

      // Edit shortcuts
      if (ctrl && e.key === 'c') {
        e.preventDefault()
        setNodes(ns => { clipboardNodes = ns.filter(n => n.selected); return ns })
      }
      if (ctrl && e.key === 'x') {
        e.preventDefault()
        setNodes(ns => {
          clipboardNodes = ns.filter(n => n.selected)
          const selectedIds = new Set(clipboardNodes.map(n => n.id))
          setEdges(es => es.filter(e => !selectedIds.has(e.source) && !selectedIds.has(e.target)))
          return ns.filter(n => !n.selected)
        })
      }
      // Ctrl+V for internal node clipboard — image paste is handled by onPaste
      if (ctrl && e.key === 'v' && clipboardNodes.length) {
        // Only paste nodes if there are copied nodes; image paste handled by onPaste event
        const copies = clipboardNodes.map(n => ({
          ...n,
          id: makeId(),
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          data: { ...n.data },
        }))
        setNodes(ns => [...ns.map(n => ({ ...n, selected: false })), ...copies])
      }
      if (ctrl && e.key === 'd') { e.preventDefault(); duplicateSelected() }

      // Delete
      if (e.key === 'Backspace' || e.key === 'Delete') deleteSelected()

      if (e.key === 'Escape') setContextMenu(null)
    }

    // Paste — image from system clipboard takes priority; falls back to node clipboard
    function onPaste(e: ClipboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const items = Array.from(e.clipboardData?.items ?? [])
      const imageItem = items.find(i => i.type.startsWith('image/'))
      if (imageItem) {
        e.preventDefault()
        const file = imageItem.getAsFile()
        if (file) pasteImageFile(file)
        return
      }
      // No image in clipboard — paste copied nodes if any
      if (clipboardNodes.length) {
        e.preventDefault()
        const copies = clipboardNodes.map(n => ({
          ...n,
          id: makeId(),
          position: { x: n.position.x + 40, y: n.position.y + 40 },
          selected: true,
          data: { ...n.data },
        }))
        setNodes(ns => [...ns.map(n => ({ ...n, selected: false })), ...copies])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [addNode, deleteSelected, duplicateSelected, pasteImageFile, setNodes, setEdges, undo, redo])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setContextMenu({ x: e.clientX, y: e.clientY, flowPos })
  }, [screenToFlowPosition])

  const onNodeDragStop = useCallback(() => {
  }, [])

  const handleRecenter = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 })
  }, [fitView])

  return (
    <div className="flex flex-col h-screen bg-[#080A0C] overflow-hidden">
      {/* Scene Timeline */}
      <SceneTimeline
        scenes={scenesWithShots}
        activeSceneId={activeSceneId}
        onSceneChange={setActiveSceneId}
        onAddScene={handleAddScene}
        onShotClick={handleShotClick}
      />

      {/* Top toolbar */}
      <CanvasToolbar
        projectName={projectName}
        onProjectNameChange={handleProjectNameChange}
        saveStatus={saveStatus === 'saving' ? 'unsaved' : saveStatus}
        projectId={projectId}
      />

      <div className="flex-1 relative" ref={flowRef} onDragOver={handleDragOver} onDrop={handleDrop} onDragLeave={handleDragLeave}>
        {isDragOver && (
          <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center border-2 border-dashed border-accent/60 bg-accent/5 rounded-lg">
            <div className="flex flex-col items-center gap-2 text-accent/80">
              <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 0-3 3m3-3 3 3M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              <span className="text-sm font-mono">Drop to add to canvas</span>
            </div>
          </div>
        )}
        {/* Ghost sticker that follows cursor when sticker tool is active */}
        {activeTool === 'sticker' && (
          <StickerGhost containerRef={flowRef} />
        )}
        
        {/* Filter nodes and edges to show only active scene */}
        {(() => {
          const sceneNodes = nodes.filter(n => n.data.sceneId === activeSceneId)
          const sceneEdges = edges.filter(e => {
            const sourceNode = nodes.find(n => n.id === e.source)
            const targetNode = nodes.find(n => n.id === e.target)
            return sourceNode?.data.sceneId === activeSceneId && targetNode?.data.sceneId === activeSceneId
          })
          
          return (
            <ReactFlow
              nodes={sceneNodes}
              edges={sceneEdges.map(edge => {
                const selectedNodeIds = new Set(sceneNodes.filter(n => n.selected).map(n => n.id))
                const isActive = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
                return {
                  ...edge,
                  animated: isActive,
                  style: { stroke: '#A855F7', strokeWidth: 2, opacity: isActive ? 1 : 0.5 },
                }
              })}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeDragStop={onNodeDragStop}
              onNodeClick={() => {
                // Close any open sticker pickers when clicking any node
                window.dispatchEvent(new Event('closeStickerPickers'))
              }}
              onPaneClick={(e) => {
                // Always close any open sticker pickers
                window.dispatchEvent(new Event('closeStickerPickers'))

                // Place sticker or comment if tool is active
                if (activeTool === 'sticker' || activeTool === 'comment') {
                  const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
                  addNode(activeTool, flowPos)
                  setActiveTool('select')
                  return
                }
                // Default: deselect all
                setNodes(ns => ns.map(n => ({ ...n, selected: false })))
              }}
              onEdgeClick={(e, edge) => {
                // Cut tool: delete clicked edge
                if (activeTool === 'cut') {
                  setEdges(es => es.filter(ed => ed.id !== edge.id))
                  return
                }
              }}
              nodeTypes={NODE_TYPES}
              onContextMenu={onContextMenu}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              zoomOnScroll
              minZoom={0.1}
              maxZoom={4}
              style={{ 
                background: '#0D0F12',
                cursor: activeTool === 'cut' ? 'crosshair' :
                       activeTool === 'sticker' ? 'none' :
                       activeTool === 'comment' ? 'copy' : 'default'
              }}
              proOptions={{ hideAttribution: true }}
              edgeTypes={EDGE_TYPES}
              defaultEdgeOptions={{
                type: 'scissors',
                style: { stroke: '#A855F7', strokeWidth: 2 },
                animated: false,
              }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="#1a1d21"
              />

              {minimapOpen && (
                <MiniMap
                  style={{
                    background: 'rgba(13,15,18,0.95)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    width: 160,
                    height: 100,
                  }}
                  maskColor="rgba(8,10,12,0.7)"
                  nodeColor="rgba(168,85,247,0.5)"
                  position="bottom-right"
                  className="!bottom-14 !right-3"
                />
              )}
            </ReactFlow>
          )
        })()}

        {/* Unified left toolbar with assets */}
        <LeftToolbar 
          onAddNode={addNode}
          onSetTool={setActiveTool}
          activeTool={activeTool}
          onUndo={undo}
          onRedo={redo}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          assets={assets}
          onAssetsChange={setAssets}
          onSelectAsset={handleSelectAsset}
          projectId={projectId}
          showHistory={showHistory}
          onShowHistoryChange={setShowHistory}
        />

        {/* Minimap toggle when closed */}
        {!minimapOpen && (
          <button
            onClick={() => setMinimapOpen(true)}
            className="absolute bottom-14 right-3 z-20 glass flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            title="Show minimap"
          >
            <MapTrifold size={14} weight="thin" />
          </button>
        )}

        {/* Close minimap button */}
        {minimapOpen && (
          <button
            onClick={() => setMinimapOpen(false)}
            className="absolute bottom-[118px] right-3 z-20 glass flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Hide minimap"
          >
            <X size={10} weight="bold" />
          </button>
        )}

        <BottomBar page={scenes.findIndex(s => s.id === activeSceneId) + 1} zoom={viewport.zoom} onRecenter={handleRecenter} />
      </div>

      {/* Context menu backdrop + menu */}
      {contextMenu && (
        <>
          <div 
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setContextMenu(null)
            }}
          />
          <AddNodeMenu
            x={contextMenu.x}
            y={contextMenu.y}
 onSelect={(item) => {
  // Special handling for Assets - open history panel instead of adding node
  if (item.id === 'assets') {
    setShowHistory(true)
    setContextMenu(null)
    return
  }
  addNode(item.nodeType, contextMenu.flowPos)
  setContextMenu(null)
  }}
            onClose={() => setContextMenu(null)}
          />
        </>
      )}
    </div>
  )
}

export function CanvasWorkspace({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  )
}
