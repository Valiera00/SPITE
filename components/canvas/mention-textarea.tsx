'use client'

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react'
import { X, User, Package, MapPin, Folder } from '@phosphor-icons/react'
import type { Asset, AssetCategory } from './asset-library'

const CATEGORY_ICONS: Record<AssetCategory, typeof User> = {
  characters: User,
  props: Package,
  locations: MapPin,
  general: Folder,
}

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  characters: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  props: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  locations: 'bg-green-500/20 text-green-400 border-green-500/30',
  general: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

export interface MentionTag {
  id: string
  name: string
  category: AssetCategory
  startIndex: number
  endIndex: number
}

interface MentionTextareaProps {
  value: string
  onChange: (value: string, mentions: MentionTag[]) => void
  placeholder?: string
  assets: Asset[]
  className?: string
  disabled?: boolean
}

export interface MentionTextareaRef {
  focus: () => void
  insertMention: (asset: Asset) => void
}

export const MentionTextarea = forwardRef<MentionTextareaRef, MentionTextareaProps>(
  ({ value, onChange, placeholder, assets, className, disabled }, ref) => {
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [suggestionQuery, setSuggestionQuery] = useState('')
    const [suggestionIndex, setSuggestionIndex] = useState(0)
    const [cursorPosition, setCursorPosition] = useState(0)
    const [mentions, setMentions] = useState<MentionTag[]>([])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // Filter assets by query
    const filteredAssets = suggestionQuery
      ? assets.filter(
          (a) =>
            a.name.toLowerCase().includes(suggestionQuery.toLowerCase()) ||
            a.tags?.some((t: string) => t.toLowerCase().includes(suggestionQuery.toLowerCase()))
        )
      : assets

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      insertMention: (asset: Asset) => insertMentionAtCursor(asset),
    }))

    const insertMentionAtCursor = useCallback(
      (asset: Asset) => {
        const textarea = textareaRef.current
        if (!textarea) return

        const start = textarea.selectionStart
        const end = textarea.selectionEnd

        // Find if we're in an @query
        const beforeCursor = value.slice(0, start)
        const atIndex = beforeCursor.lastIndexOf('@')
        const insertStart = atIndex >= 0 ? atIndex : start

        const mentionText = `@${asset.name}`
        const newValue = value.slice(0, insertStart) + mentionText + ' ' + value.slice(end)

        // Create mention tag
        const newMention: MentionTag = {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          startIndex: insertStart,
          endIndex: insertStart + mentionText.length,
        }

        // Update mentions array, adjusting positions
        const adjustedMentions = mentions
          .filter((m) => m.endIndex <= insertStart || m.startIndex >= end)
          .map((m) => {
            if (m.startIndex >= end) {
              const shift = insertStart + mentionText.length + 1 - end
              return { ...m, startIndex: m.startIndex + shift, endIndex: m.endIndex + shift }
            }
            return m
          })

        setMentions([...adjustedMentions, newMention])
        onChange(newValue, [...adjustedMentions, newMention])
        setShowSuggestions(false)
        setSuggestionQuery('')

        // Move cursor after mention
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = insertStart + mentionText.length + 1
          textarea.focus()
        }, 0)
      },
      [value, mentions, onChange]
    )

    // Handle input change
    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPos = e.target.selectionStart

      // Check if we're typing after @
      const beforeCursor = newValue.slice(0, cursorPos)
      const atIndex = beforeCursor.lastIndexOf('@')
      const hasSpaceAfterAt = atIndex >= 0 && beforeCursor.slice(atIndex).includes(' ')

      if (atIndex >= 0 && !hasSpaceAfterAt) {
        const query = beforeCursor.slice(atIndex + 1)
        setSuggestionQuery(query)
        setShowSuggestions(true)
        setSuggestionIndex(0)
      } else {
        setShowSuggestions(false)
        setSuggestionQuery('')
      }

      setCursorPosition(cursorPos)
      onChange(newValue, mentions)
    }

    // Handle keyboard navigation in suggestions
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions || filteredAssets.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestionIndex((i) => (i + 1) % filteredAssets.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestionIndex((i) => (i - 1 + filteredAssets.length) % filteredAssets.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredAssets[suggestionIndex]) {
          e.preventDefault()
          insertMentionAtCursor(filteredAssets[suggestionIndex])
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false)
      }
    }

    // Remove mention tag
    const removeMention = (mentionId: string) => {
      const mention = mentions.find((m) => m.id === mentionId)
      if (!mention) return

      const newValue = value.slice(0, mention.startIndex) + value.slice(mention.endIndex)
      const updatedMentions = mentions
        .filter((m) => m.id !== mentionId)
        .map((m) => {
          if (m.startIndex > mention.endIndex) {
            const shift = mention.endIndex - mention.startIndex
            return { ...m, startIndex: m.startIndex - shift, endIndex: m.endIndex - shift }
          }
          return m
        })

      setMentions(updatedMentions)
      onChange(newValue, updatedMentions)
    }

    return (
      <div ref={containerRef} className="relative">
        {/* Mention tags display */}
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {mentions.map((mention) => {
              const Icon = CATEGORY_ICONS[mention.category]
              return (
                <span
                  key={mention.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${CATEGORY_COLORS[mention.category]}`}
                >
                  <Icon size={10} weight="fill" />
                  {mention.name}
                  <button
                    onClick={() => removeMention(mention.id)}
                    className="ml-0.5 hover:opacity-70 transition-opacity"
                  >
                    <X size={8} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none resize-none ${className}`}
          rows={3}
        />

        {/* Suggestions dropdown */}
        {showSuggestions && filteredAssets.length > 0 && (
          <div className="absolute left-0 right-0 bottom-full mb-1 z-50 max-h-48 overflow-y-auto glass rounded-lg border border-border/50 py-1">
            {filteredAssets.map((asset, i) => {
              const Icon = CATEGORY_ICONS[asset.category]
              return (
                <button
                  key={asset.id}
                  onClick={() => insertMentionAtCursor(asset)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    i === suggestionIndex ? 'bg-accent/20' : 'hover:bg-white/5'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded flex items-center justify-center ${CATEGORY_COLORS[asset.category]}`}
                  >
                    <Icon size={12} weight="fill" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-foreground truncate">{asset.name}</div>
                    <div className="text-[9px] font-mono text-muted-foreground/50 capitalize">
                      {asset.category}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Helper text */}
        <div className="text-[9px] font-mono text-muted-foreground/40 mt-1">
          Type @ to mention characters, props, or locations
        </div>
      </div>
    )
  }
)

MentionTextarea.displayName = 'MentionTextarea'
