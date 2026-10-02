import type { ModelConfig } from './fal-models'

// Approximate per-unit cost in USD for each model. Numbers are
// intentionally on the high side so the estimate trends "you might pay
// a bit more than this" rather than "you'll pay less than this".
// Real billed cost is whatever fal records in their dashboard.
//
// For models priced per generated second (Kling v3 variants), the unit
// is 'sec' — the helper multiplies by the chosen duration.
// For everything else the unit is 'image' or 'video' and the per-unit
// price already covers a typical generation at default settings.
type Unit = 'image' | 'video' | 'sec'

// `byTier` prices a model whose cost moves with the selector shown in the UI.
// That selector is `ModelConfig.resolutions`, which is a RESOLUTION for most
// models (1K/2K/4K) but a QUALITY mode for others (Ideogram's rendering
// speed) — either way the chosen value is the key here.
//
// `price` stays the flat fallback and MUST be >= the dearest tier: it is what
// gets charged when the tier is unknown ('auto', or a caller that passes
// nothing and the model declares no default), and the gate must never
// under-estimate.
interface CostEntry {
  unit: Unit
  price: number
  byTier?: Record<string, number>
  // Same tiers for when the model also GENERATES sound and fal bills that at
  // a higher rate (Veo doubles; PixVerse adds ~30%). Used when the sound
  // toggle is on — or unknown, since the gate must assume the dearer case.
  byTierAudio?: Record<string, number>
}

const COST_TABLE: Record<string, CostEntry> = {
  // Image models
  // Nano Banana 2: $0.08 base at 1K, scaled by fal's published multipliers —
  // 0.5K x0.75, 2K x1.5, 4K x2. (Web search +$0.015 and high thinking +$0.002
  // are extras this app never enables.)
  'nano-banana-2':       { unit: 'image', price: 0.16,
                           byTier: { '0.5K': 0.06, '1K': 0.08, '2K': 0.12, '4K': 0.16 } },
  // Nano Banana Pro: flat $0.15, except "4K outputs charged at double".
  'nano-banana-pro':     { unit: 'image', price: 0.30,
                           byTier: { '1K': 0.15, '2K': 0.15, '4K': 0.30 } },
  'flux-schnell':        { unit: 'image', price: 0.003 },
  'flux-dev':            { unit: 'image', price: 0.025 },
  // Kling o1: fal charges $0.028 per image at BOTH 1K and 2K — no tier split.
  'kling-o1':            { unit: 'image', price: 0.028 },
  // GPT Image 2 is priced per quality tier x size, and buildModelInput pins
  // quality to 'high' — the dearest tier — so these come off fal's published
  // high-quality table. The exact pixel sizes this app sends aren't all listed
  // there and the rates don't scale linearly with pixels (1024x1024 costs MORE
  // than the larger 1920x1080, because OpenAI bills output image tokens), so
  // each tier takes the CEILING of the published sizes it spans rather than an
  // interpolation. 4K is exact: 3840x2160 high = $0.401.
  'gpt-image-2':         { unit: 'image', price: 0.41,
                           byTier: { '1K': 0.21, '2K': 0.25, '4K': 0.41 } },
  'flux-2-pro':          { unit: 'image', price: 0.05 },
  // Ideogram v4 bills per megapixel by rendering speed: TURBO $0.0075,
  // BALANCED $0.015, QUALITY $0.025. The largest frame this app can request
  // is 4:3 at 1408x1056 = 1.487 MP, so each tier is that ceiling.
  'ideogram-v4':         { unit: 'image', price: 0.038,
                           byTier: { TURBO: 0.012, BALANCED: 0.023, QUALITY: 0.038 } },
  // Video models
  // All per-second rates below are from fal's model pages (Oct 2026) and are
  // priced by the resolution actually selected.
  //
  // Seedance 1.5 Pro bills video tokens — (h x w x 24fps x seconds) / 1024 —
  // at $2.40 per million WITH audio, half that without. This app sends no
  // generate_audio flag for 1.5, so fal's default (audio on) applies and the
  // with-audio rate is the one charged. fal's own example: 720p, 5s = $0.26.
  'seedance-1.5':        { unit: 'sec',   price: 0.117,
                           byTier: { '480p': 0.024, '720p': 0.052, '1080p': 0.117 } },
  // Seedance 2.0: $0.3034/s at 720p, $0.682/s at 1080p; 480p comes off the
  // token formula ($0.014 per 1000 tokens) at about $0.135/s. Audio is
  // generated in the same pass and does not change the price.
  'seedance-2.0':        { unit: 'sec',   price: 0.69,
                           byTier: { '480p': 0.14, '720p': 0.31, '1080p': 0.69 } },
  // Seedance 2.5: $0.2205/s 480p, $0.473/s 720p, $1.164/s 1080p. Clips run to
  // 30s, so a 1080p maximum-length render is about $35.
  'seedance-2.5':        { unit: 'sec',   price: 1.164,
                           byTier: { '480p': 0.221, '720p': 0.473, '1080p': 1.164 } },
  // Sept 2026 arena leaders. All billed per second on fal.
  // Wan 3.0: $0.05/s 480p, $0.10/s 720p, $0.20/s 1080p (the default).
  'wan-3.0':             { unit: 'sec',   price: 0.20,
                           byTier: { '480p': 0.05, '720p': 0.10, '1080p': 0.20 } },
  // H3 Max: $0.05/s 480P, $0.08/s 768P (default), $0.16/s 1080P. These are
  // the regular rates — the half-price launch promo ended 30 Sept 2026.
  'minimax-h3-max':      { unit: 'sec',   price: 0.16,
                           byTier: { '480P': 0.05, '768P': 0.08, '1080P': 0.16 } },
  // Gemini Omni Flash: fal lists $0.13/s. Rounded up.
  'gemini-omni-flash':   { unit: 'sec',   price: 0.15 },
  'kling-1.0':           { unit: 'video', price: 0.50 },
  'kling-1.5':           { unit: 'video', price: 0.50 },
  'kling-1.6':           { unit: 'video', price: 0.50 },
  // Kling 2.6 Pro: $0.07/s without audio, $0.14/s with audio,
  // $0.168/s with audio + voice control. Splitting at $0.10/s
  // blended for the typical with-audio path.
  'kling-2.6':           { unit: 'sec',   price: 0.10 },
  // Motion-control (Kling 2.6 Pro) — no duration param exposed; flat per-video
  // estimate for the spend gate.
  'kling-2.6-motion-control-pro': { unit: 'video', price: 0.80 },
  'kling-3.0-standard':  { unit: 'sec',   price: 0.14 },
  'kling-3.0-pro':       { unit: 'sec',   price: 0.30 },
  'kling-3.0-4k':        { unit: 'sec',   price: 0.50 },
  'minimax-hailuo':      { unit: 'video', price: 0.50 },
  'minimax-hailuo-2.3':  { unit: 'video', price: 0.65 },  // 2.3 is slightly pricier than original
  // Kling o1 first-frame-last-frame: docs say $0.112 per second.
  'kling-o1-video':      { unit: 'sec',   price: 0.112 },
  // Luma Ray 2: $0.50 per 5s clip at 540p, 2x at 720p, 4x at 1080p; a 9s clip
  // costs double a 5s one. Expressed per second at the 9s rate, so a 9s clip
  // estimates exactly and a 5s clip ~10% high rather than low.
  'luma-ray2':           { unit: 'sec',   price: 0.445,
                           byTier: { '540p': 0.112, '720p': 0.223, '1080p': 0.445 } },
  // 2026 video additions.
  // Veo 3.1: 720p and 1080p cost the same — $0.20/s silent, $0.40/s with
  // sound; 4K is $0.40/s silent, $0.60/s with sound.
  'veo-3.1':             { unit: 'sec',   price: 0.60,
                           byTier:      { '720p': 0.20, '1080p': 0.20, '4K': 0.40 },
                           byTierAudio: { '720p': 0.40, '1080p': 0.40, '4K': 0.60 } },
  // Veo 3.1 Fast: $0.10/s silent, $0.15/s with sound; 4K $0.30 / $0.35.
  'veo-3.1-fast':        { unit: 'sec',   price: 0.35,
                           byTier:      { '720p': 0.10, '1080p': 0.10, '4K': 0.30 },
                           byTierAudio: { '720p': 0.15, '1080p': 0.15, '4K': 0.35 } },
  // Happy Horse: $0.14/s at 720p, $0.28/s at 1080p.
  'happy-horse':         { unit: 'sec',   price: 0.28,
                           byTier: { '720p': 0.14, '1080p': 0.28 } },
  // LTX-Video 13b: $0.04/s whatever the resolution ($0.08 with the detail
  // pass, which this app never enables).
  'ltx-video-13b':       { unit: 'sec',   price: 0.04 },
  // PixVerse V6: per second by resolution, with a surcharge for sound.
  'pixverse-v6':         { unit: 'sec',   price: 0.115,
                           byTier:      { '360p': 0.025, '540p': 0.035, '720p': 0.045, '1080p': 0.09 },
                           byTierAudio: { '360p': 0.035, '540p': 0.045, '720p': 0.06,  '1080p': 0.115 } },
  // Topaz video upscale bills per second of the SOURCE clip by output size:
  // $0.01 up to 720p, $0.02 up to 1080p, $0.08 above (60fps doubles it). The
  // source clip's length isn't known here, so this stays one flat figure: a
  // little over 10 seconds at the top rate.
  'topaz-video-upscale': { unit: 'video', price: 1.00 },
  // Depth Anything Video: $0.04 per second of the SOURCE clip. Its length
  // isn't known here either, so the flat figure covers a 30s clip — the
  // longest this app can generate.
  'depth-anything-video': { unit: 'video', price: 1.20 },
  // Wan VACE Depth: $0.04/s at 480p, $0.06/s at 580p, $0.08/s at 720p. fal
  // lists no rate for 'auto', 240p or 360p, so those fall back to the 720p
  // rate rather than guess low.
  'wan-vace-depth':       { unit: 'sec',  price: 0.08,
                           byTier: { '480p': 0.04, '580p': 0.06, '720p': 0.08 } },
  // Image upscalers — per-image estimates (real cost is per-megapixel on fal,
  // so these are conservative gate ceilings, not exact billing).
  'topaz-image-upscale':   { unit: 'image', price: 0.08 },
  'clarity-image-upscale': { unit: 'image', price: 0.05 },
  'esrgan-image-upscale':  { unit: 'image', price: 0.02 },
}

export interface CostEstimate {
  perUnit: number   // estimated $ per generated output
  total: number     // estimated total $ for this batch
  unit: Unit
  isKnown: boolean  // false when we don't have pricing data for this model
  /** Tier the price came from, when the model has tiered pricing. For display. */
  tier?: string
}

// Resolve the per-output base price for a tiered model. Falls back to the
// model's own default when the caller passes no tier, and to the flat `price`
// (>= the dearest tier by construction) when the tier isn't one we have a
// number for — 'auto' being the common case.
function basePrice(
  entry: CostEntry,
  model: ModelConfig,
  resolution?: string,
  audio?: boolean,
): { price: number; tier?: string } {
  // The sound-on table applies only when the model can generate sound at all
  // AND the toggle isn't explicitly off. An unknown toggle counts as on.
  const soundOn = !!model.supportsAudio && audio !== false
  const table = soundOn && entry.byTierAudio ? entry.byTierAudio : entry.byTier
  if (!table) return { price: entry.price }
  const tier = resolution || model.defaultResolution
  if (tier && table[tier] !== undefined) {
    return { price: table[tier], tier }
  }
  return { price: entry.price }
}

// Longest duration a model offers, in seconds. 'auto' lets the model choose
// the length itself, so the only safe assumption for a spend gate is the
// maximum — pricing it at the 5s default under-estimated a 30s render 6x.
function longestDuration(model: ModelConfig): number | undefined {
  const secs = (model.durations || [])
    .map((d) => parseInt(d))
    .filter((n) => Number.isFinite(n) && n > 0)
  return secs.length ? Math.max(...secs) : undefined
}

export function estimateGenerationCost(
  model: ModelConfig | null | undefined,
  options: {
    count: number
    durationSeconds?: number
    resolution?: string
    /** Sound toggle. Omit when unknown — the dearer rate is then assumed. */
    audio?: boolean
    /** Duration is 'auto' (model decides): price the longest it can pick. */
    autoDuration?: boolean
  },
): CostEstimate {
  if (!model) {
    return { perUnit: 0, total: 0, unit: 'image', isKnown: false }
  }
  const entry = COST_TABLE[model.id]
  if (!entry) {
    return { perUnit: 0, total: 0, unit: model.category === 'video' ? 'video' : 'image', isKnown: false }
  }
  const { price, tier } = basePrice(entry, model, options.resolution, options.audio)
  let perUnit = price
  if (entry.unit === 'sec') {
    const dur =
      (options.autoDuration ? longestDuration(model) : undefined) ||
      options.durationSeconds ||
      parseInt(model.defaultDuration || '5')
    perUnit = price * (Number.isFinite(dur) && dur > 0 ? dur : 5)
  }
  return {
    perUnit,
    total: perUnit * Math.max(1, options.count),
    unit: entry.unit === 'sec' ? 'video' : entry.unit,
    isKnown: true,
    tier,
  }
}

export function formatUSD(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return '<$0.01'
  if (amount < 1) return `$${amount.toFixed(2)}`
  if (amount < 100) return `$${amount.toFixed(2)}`
  return `$${amount.toFixed(0)}`
}

// Threshold at which we force an explicit user confirmation before
// firing the submission. Deliberately high — the goal is to catch
// "panic spiral" patterns (x12 Seedance batches and similar) without
// interrupting normal professional work. The fal balance badge in the
// canvas toolbar gives the user ambient awareness of their spend; this
// confirm only fires when a single click would move it noticeably.
//
// Reasoning:
//   $25 ≈ 5 Seedance shots in one click, or one absurd x12 NBP batch.
//   Below this is "normal work" and shouldn't be gated.
//   Above this is "are you SURE" territory.
export const COST_CONFIRM_THRESHOLD_USD = 25
