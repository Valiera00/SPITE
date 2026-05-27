'use client'

import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Search, Download, Trash2, Lock, Copy, Check, X,
  Image as ImageIcon, Video, Clock, SlidersHorizontal, Heart
} from 'lucide-react'
import Image from 'next/image'

interface Asset {
  id: string
  type: 'image' | 'video'
  model: string
  prompt: string
  r2_url: string
  usedincanvas: boolean
  createdat: string
}

type FilterType = 'all' | 'image' | 'video' | 'protected'

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    const loadAssets = async () => {
      try {
        const res = await fetch('/api/assets')
        if (res.ok) {
          const data = await res.json()
          setAssets(data)
        }
      } catch (err) {
        console.error('Failed to load assets:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAssets()
  }, [])

  // Filter and search assets
  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      // Type filter
      if (filterType === 'image' && asset.type !== 'image') return false
      if (filterType === 'video' && asset.type !== 'video') return false
      if (filterType === 'protected' && !asset.usedincanvas) return false
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          asset.prompt.toLowerCase().includes(query) ||
          asset.model.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [assets, filterType, searchQuery])

  // Group assets by month
  const groupedAssets = useMemo(() => {
    const groups: Record<string, Asset[]> = {}
    filteredAssets.forEach(asset => {
      const date = new Date(asset.createdat)
      const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!groups[monthYear]) groups[monthYear] = []
      groups[monthYear].push(asset)
    })
    return groups
  }, [filteredAssets])

  const handleDelete = async (assetId: string) => {
    setDeleting(assetId)
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: 'DELETE' })
      if (res.ok) {
        setAssets(assets.filter(a => a.id !== assetId))
        if (selectedAsset?.id === assetId) setSelectedAsset(null)
      }
    } catch (err) {
      console.error('Failed to delete asset:', err)
    } finally {
      setDeleting(null)
    }
  }

  const copyPrompt = () => {
    if (selectedAsset) {
      navigator.clipboard.writeText(selectedAsset.prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0c]">
        <p className="text-zinc-500">Loading assets...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[#0a0a0c] text-zinc-100">
      {/* Left Sidebar - Filters */}
      <aside className="w-56 border-r border-zinc-800 p-4 flex flex-col gap-1">
        <h2 className="text-sm font-medium text-zinc-400 mb-3 px-2">Library</h2>
        
        <button
          onClick={() => setFilterType('all')}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            filterType === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <Clock size={16} />
          History
        </button>
        
        <button
          onClick={() => setFilterType('image')}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            filterType === 'image' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <ImageIcon size={16} />
          Images
        </button>
        
        <button
          onClick={() => setFilterType('video')}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            filterType === 'video' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <Video size={16} />
          Videos
        </button>
        
        <button
          onClick={() => setFilterType('protected')}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            filterType === 'protected' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <Lock size={16} />
          In Canvas
        </button>

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 px-2">
            {assets.length} total assets
          </p>
          <p className="text-xs text-zinc-600 px-2">
            {assets.filter(a => a.usedincanvas).length} protected
          </p>
        </div>
      </aside>

      {/* Main Content - Grid */}
      <main className="flex-1 overflow-y-auto">
        {/* Header with search */}
        <div className="sticky top-0 bg-[#0a0a0c]/95 backdrop-blur-sm border-b border-zinc-800 p-4 flex items-center gap-4">
          <h1 className="text-lg font-medium">
            {filterType === 'all' ? 'History' : 
             filterType === 'image' ? 'Images' :
             filterType === 'video' ? 'Videos' : 'Protected Assets'}
          </h1>
          
          <div className="flex-1 max-w-md ml-auto flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search prompts, models..."
                className="pl-9 bg-zinc-900 border-zinc-700 text-sm h-9"
              />
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-zinc-400">
              <SlidersHorizontal size={16} />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-zinc-400">
              <Heart size={16} />
            </Button>
          </div>
        </div>

        {/* Asset Grid */}
        <div className="p-4">
          {Object.keys(groupedAssets).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
              <ImageIcon size={48} className="mb-4 opacity-50" />
              <p>No assets found</p>
              <p className="text-sm text-zinc-600">Generate some images or videos to see them here</p>
            </div>
          ) : (
            Object.entries(groupedAssets).map(([monthYear, monthAssets]) => (
              <div key={monthYear} className="mb-8">
                <h3 className="text-sm text-zinc-400 mb-3">{monthYear}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {monthAssets.map(asset => (
                    <button
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset)}
                      className={`group relative aspect-square rounded-lg overflow-hidden bg-zinc-900 border-2 transition-all ${
                        selectedAsset?.id === asset.id 
                          ? 'border-purple-500 ring-2 ring-purple-500/30' 
                          : 'border-transparent hover:border-zinc-700'
                      }`}
                    >
                      {asset.type === 'image' ? (
                        <Image
                          src={asset.r2_url}
                          alt={asset.prompt}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <video
                          src={asset.r2_url}
                          className="w-full h-full object-cover"
                          muted
                          onMouseEnter={(e) => e.currentTarget.play()}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
                        />
                      )}
                      
                      {/* Type indicator */}
                      <div className="absolute top-2 left-2">
                        {asset.type === 'video' && (
                          <div className="bg-black/60 backdrop-blur-sm rounded p-1">
                            <Video size={12} className="text-white" />
                          </div>
                        )}
                      </div>
                      
                      {/* Protected indicator */}
                      {asset.usedincanvas && (
                        <div className="absolute top-2 right-2 bg-purple-500/80 backdrop-blur-sm rounded p-1">
                          <Lock size={12} className="text-white" />
                        </div>
                      )}
                      
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Right Panel - Asset Details */}
      {selectedAsset ? (
        <aside className="w-80 border-l border-zinc-800 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => window.open(selectedAsset.r2_url, '_blank')}
              >
                Share
              </Button>
              <Button 
                size="sm"
                onClick={() => window.open(selectedAsset.r2_url, '_blank')}
                className="bg-zinc-100 text-zinc-900 hover:bg-white"
              >
                Download
              </Button>
            </div>
            <Button 
              size="icon" 
              variant="ghost" 
              className="h-8 w-8"
              onClick={() => setSelectedAsset(null)}
            >
              <X size={16} />
            </Button>
          </div>
          
          {/* Preview */}
          <div className="p-4">
            <div className="relative aspect-video rounded-lg overflow-hidden bg-zinc-900">
              {selectedAsset.type === 'image' ? (
                <Image
                  src={selectedAsset.r2_url}
                  alt={selectedAsset.prompt}
                  fill
                  className="object-contain"
                />
              ) : (
                <video
                  src={selectedAsset.r2_url}
                  className="w-full h-full object-contain"
                  controls
                />
              )}
            </div>
          </div>
          
          {/* Metadata */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="space-y-4">
              <div className="flex justify-between py-3 border-b border-zinc-800">
                <span className="text-sm text-zinc-500">Type</span>
                <span className="text-sm capitalize">{selectedAsset.type}</span>
              </div>
              
              <div className="flex justify-between py-3 border-b border-zinc-800">
                <span className="text-sm text-zinc-500">Date Created</span>
                <span className="text-sm">{formatDate(selectedAsset.createdat)}</span>
              </div>
              
              <div className="flex justify-between py-3 border-b border-zinc-800">
                <span className="text-sm text-zinc-500">AI Model</span>
                <span className="text-sm">{selectedAsset.model || '—'}</span>
              </div>
              
              <div className="flex justify-between py-3 border-b border-zinc-800">
                <span className="text-sm text-zinc-500">Status</span>
                <span className="text-sm flex items-center gap-1">
                  {selectedAsset.usedincanvas ? (
                    <>
                      <Lock size={12} className="text-purple-400" />
                      Protected
                    </>
                  ) : (
                    'Available'
                  )}
                </span>
              </div>
              
              {/* Prompt section */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-500">Prompt</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={copyPrompt}
                  >
                    {copied ? (
                      <>
                        <Check size={12} className="mr-1" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} className="mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-sm text-zinc-300 bg-zinc-900 rounded-lg p-3 leading-relaxed">
                  {selectedAsset.prompt}
                </p>
              </div>
            </div>
          </div>
          
          {/* Delete button */}
          {!selectedAsset.usedincanvas && (
            <div className="p-4 border-t border-zinc-800">
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => handleDelete(selectedAsset.id)}
                disabled={deleting === selectedAsset.id}
              >
                <Trash2 size={14} className="mr-2" />
                Delete Asset
              </Button>
            </div>
          )}
        </aside>
      ) : (
        <aside className="w-80 border-l border-zinc-800 flex flex-col items-center justify-center text-zinc-500 p-8">
          <ImageIcon size={48} className="mb-4 opacity-30" />
          <p className="text-center text-sm">Select an asset to view details</p>
        </aside>
      )}
    </div>
  )
}
