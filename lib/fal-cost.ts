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
  'seedance-1.5':        { unit: 'video', price: 4.50 },  // ~5sec 720p — same tier as 2.0
  'seedance-2.0':        { unit: 'video', price: 4.50 },  // ~5sec 720p Seedance
  // Seedance 2.5 is billed per second: $0.2205/s at 480p, $0.473/s at
  // 720p, $1.164/s at 1080p (fal, Sept 2026). Clips run up to 30s, so a
  // flat per-video number would be wildly wrong at either end. $0.50/s is
  // the 720p default rounded up; 1080p runs will be under-estimated.
  'seedance-2.5':        { unit: 'sec',   price: 0.50 },
  // Sept 2026 arena leaders. All billed per second on fal.
  // Wan 3.0: $0.05/s 480p, $0.10/s 720p, $0.20/s 1080p (the default).
  'wan-3.0':             { unit: 'sec',   price: 0.20 },
  // H3 Max: $0.0125/s 480P, $0.02/s 768P (default), 1080P is 2x. Rounded up.
  'minimax-h3-max':      { unit: 'sec',   price: 0.05 },
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
  'luma-ray2':           { unit: 'video', price: 1.50 },
  // 2026 video additions.
  // Veo 3.1: docs say $0.20/s base, $0.40/s with audio at 720p/1080p.
  // Splitting the difference at $0.30/s as a conservative blended rate.
  'veo-3.1':             { unit: 'sec',   price: 0.30 },
  // Veo 3.1 Fast: $0.10/s base, $0.15/s with audio. ~$0.12/s blended.
  'veo-3.1-fast':        { unit: 'sec',   price: 0.12 },
  'happy-horse':         { unit: 'video', price: 0.40 },  // unknown; 1080p i2v
  'ltx-video-13b':       { unit: 'video', price: 0.10 },  // open source, cheap
  'pixverse-v6':         { unit: 'video', price: 0.30 },  // unknown; estimate
  // Upscalers — flat-rate estimate covering up to ~10sec at 4x.
  'topaz-video-upscale': { unit: 'video', price: 1.00 },
  // Depth chain — fal publishes no price on either model page, and the submit
  // route fails closed on unknown cost, so these are deliberately HIGH
  // placeholders: the gate stays conservative until a real bill lands. Depth
  // estimation is pure inference (cheap); VACE is a 14B generative pass.
  // Correct both from fal's billing page after the first run.
  'depth-anything-video': { unit: 'video', price: 0.30 },
  'wan-vace-depth':       { unit: 'video', price: 1.00 },
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
): { price: number; tier?: string } {
  if (!entry.byTier) return { price: entry.price }
  const tier = resolution || model.defaultResolution
  if (tier && entry.byTier[tier] !== undefined) {
    return { price: entry.byTier[tier], tier }
  }
  return { price: entry.price }
}

export function estimateGenerationCost(
  model: ModelConfig | null | undefined,
  options: { count: number; durationSeconds?: number; resolution?: string },
): CostEstimate {
  if (!model) {
    return { perUnit: 0, total: 0, unit: 'image', isKnown: false }
  }
  const entry = COST_TABLE[model.id]
  if (!entry) {
    return { perUnit: 0, total: 0, unit: model.category === 'video' ? 'video' : 'image', isKnown: false }
  }
  const { price, tier } = basePrice(entry, model, options.resolution)
  let perUnit = price
  if (entry.unit === 'sec') {
    const dur = options.durationSeconds || parseInt(model.defaultDuration || '5')
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
