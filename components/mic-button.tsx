'use client'

import { Microphone } from '@phosphor-icons/react'
import type { SpeechInput } from '@/lib/use-speech-input'

// Dictation toggle for a prompt box. Renders NOTHING when the browser has no
// speech recognizer (Firefox, SSR) — a mic that can't listen is worse than no
// mic at all, so the control simply isn't there.
//
// Two shapes: `pill` matches the Flow composer's h-8 control row, `ghost` is
// the compact square that tucks into a canvas node's prompt corner.

interface Props {
  speech: SpeechInput
  variant?: 'pill' | 'ghost'
  disabled?: boolean
  className?: string
}

export function MicButton({ speech, variant = 'ghost', disabled, className }: Props) {
  const { supported, listening, interim, error, toggle } = speech
  if (!supported) return null

  const size = variant === 'pill' ? 14 : 13
  const base =
    variant === 'pill'
      ? 'flex items-center justify-center h-8 w-8 rounded-full transition active:scale-95'
      : 'flex items-center justify-center h-6 w-6 rounded-md transition active:scale-95'

  const tone = listening
    ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
    : variant === 'pill'
      ? 'bg-white/[0.06] hover:bg-white/10 text-foreground/80'
      : 'text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/[0.06]'

  return (
    <div className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={listening ? 'Stop dictation' : 'Dictate prompt'}
        aria-pressed={listening}
        // Chrome sends the audio to Google to transcribe; say so rather than
        // leaving it to be discovered.
        title={
          listening
            ? 'Listening — click to stop'
            : 'Dictate the prompt. Audio is transcribed by your browser’s speech service (Google in Chrome, Apple in Safari).'
        }
        className={`nodrag ${base} ${tone} disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <Microphone size={size} weight={listening ? 'fill' : 'regular'} />
        {listening && (
          <span
            className={`absolute inset-0 animate-ping bg-rose-500/20 pointer-events-none ${
              variant === 'pill' ? 'rounded-full' : 'rounded-md'
            }`}
          />
        )}
      </button>

      {/* Live feedback. Interim words while speaking, or the reason it stopped.
          Floats above so it never reflows the prompt box. */}
      {(listening || error) && (
        <div
          className={`absolute bottom-full right-0 mb-1.5 z-50 max-w-[220px] w-max px-2 py-1 rounded-md border text-[10px] leading-snug pointer-events-none ${
            error
              ? 'bg-rose-950/95 border-rose-500/40 text-rose-200'
              : 'bg-[#0E1014]/95 border-white/10 text-foreground/70'
          }`}
        >
          {error || (interim ? interim : 'Listening…')}
        </div>
      )}
    </div>
  )
}
