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
const COST_TABLE: Record<string, { unit: Unit; price: number }> = {
  // Image models
  'nano-banana-2':       { unit: 'image', price: 0.04 },
  'nano-banana-pro':     { unit: 'image', price: 0.15 },
  'flux-schnell':        { unit: 'image', price: 0.003 },
  'flux-dev':            { unit: 'image', price: 0.025 },
  'kling-o1':            { unit: 'image', price: 0.10 },
  // Video models
  'seedance-2.0':        { unit: 'video', price: 4.50 },  // ~5sec 720p Seedance
  'kling-1.0':           { unit: 'video', price: 0.50 },
  'kling-1.5':           { unit: 'video', price: 0.50 },
  'kling-1.6':           { unit: 'video', price: 0.50 },
  'kling-3.0-standard':  { unit: 'sec',   price: 0.14 },
  'kling-3.0-pro':       { unit: 'sec',   price: 0.30 },
  'kling-3.0-4k':        { unit: 'sec',   price: 0.50 },
  'kling-o1-video':      { unit: 'video', price: 1.50 },
  'minimax-hailuo':      { unit: 'video', price: 0.50 },
  'luma-ray2':           { unit: 'video', price: 1.50 },
}

export interface CostEstimate {
  perUnit: number   // estimated $ per generated output
  total: number     // estimated total $ for this batch
  unit: Unit
  isKnown: boolean  // false when we don't have pricing data for this model
}

export function estimateGenerationCost(
  model: ModelConfig | null | undefined,
  options: { count: number; durationSeconds?: number },
): CostEstimate {
  if (!model) {
    return { perUnit: 0, total: 0, unit: 'image', isKnown: false }
  }
  const entry = COST_TABLE[model.id]
  if (!entry) {
    return { perUnit: 0, total: 0, unit: model.category === 'video' ? 'video' : 'image', isKnown: false }
  }
  let perUnit = entry.price
  if (entry.unit === 'sec') {
    const dur = options.durationSeconds || parseInt(model.defaultDuration || '5')
    perUnit = entry.price * (Number.isFinite(dur) && dur > 0 ? dur : 5)
  }
  return {
    perUnit,
    total: perUnit * Math.max(1, options.count),
    unit: entry.unit === 'sec' ? 'video' : entry.unit,
    isKnown: true,
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
// firing the submission. Catches batch operations and any single
// Seedance / Kling Pro generation, while letting cheap one-shots
// through.
export const COST_CONFIRM_THRESHOLD_USD = 0.5
