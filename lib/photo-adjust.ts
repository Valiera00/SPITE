// Pixel math for the photo editor's Adjust tool. Pure functions over a raw
// RGBA buffer so the SAME code runs on the small preview while a slider is
// being dragged and on the full-resolution image at export — what you see is
// exactly what you save. No canvas filter() involvement: Safari's support for
// that is patchy, and a CSS filter can't do temperature or tint anyway.

export interface Adjustments {
  /** -100..100. Multiplies every channel: +100 doubles, -100 blacks out. */
  exposure: number
  /** -100..100. Stretches values away from mid-grey (or towards it). */
  contrast: number
  /** -100..100. -100 is fully desaturated. */
  saturation: number
  /** -100..100. Negative is cooler (blue), positive warmer (orange). */
  temperature: number
  /** -100..100. Negative is green, positive magenta. */
  tint: number
  /** 0..100. Darkens towards the corners. */
  vignette: number
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
}

export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL_ADJUSTMENTS) as (keyof Adjustments)[]).every((k) => a[k] === 0)
}

/** The subset of ImageData we touch, so this runs in Node for tests too. */
export interface RgbaBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Apply `adj` to `buf` in place. Channel order per pixel: R, G, B, A; alpha is
 * left alone. Uint8ClampedArray clamps on write, so no manual clamping.
 */
export function applyAdjustments(buf: RgbaBuffer, adj: Adjustments): RgbaBuffer {
  if (isNeutral(adj)) return buf
  const { data, width, height } = buf

  // Precomputed scalars — the per-pixel loop should only multiply and add.
  const exposure = 1 + adj.exposure / 100
  const contrast = 1 + adj.contrast / 100
  const saturation = 1 + adj.saturation / 100
  // ±100 moves red/blue by ±50 levels: clearly visible, still a photo.
  const temp = adj.temperature * 0.5
  // Magenta is "less green", so positive tint pulls green down.
  const tint = -adj.tint * 0.4
  const vig = adj.vignette / 100

  // Vignette falloff: nothing inside ~45% of the half-diagonal, then a smooth
  // ramp to `vig` darkening at the corners.
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const maxD = Math.sqrt(cx * cx + cy * cy) || 1
  const vigStart = 0.45

  let i = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      let r = data[i]
      let g = data[i + 1]
      let b = data[i + 2]

      if (exposure !== 1) {
        r *= exposure; g *= exposure; b *= exposure
      }
      if (contrast !== 1) {
        r = (r - 128) * contrast + 128
        g = (g - 128) * contrast + 128
        b = (b - 128) * contrast + 128
      }
      if (saturation !== 1) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b
        r = l + (r - l) * saturation
        g = l + (g - l) * saturation
        b = l + (b - l) * saturation
      }
      if (temp !== 0) {
        r += temp; b -= temp
      }
      if (tint !== 0) {
        g += tint
      }
      if (vig !== 0) {
        const dx = x - cx, dy = y - cy
        const d = Math.sqrt(dx * dx + dy * dy) / maxD
        if (d > vigStart) {
          // smoothstep from vigStart..1
          let t = (d - vigStart) / (1 - vigStart)
          t = t * t * (3 - 2 * t)
          const f = 1 - vig * t
          r *= f; g *= f; b *= f
        }
      }

      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
    }
  }
  return buf
}

// ---------------------------------------------------------------------------
// Crop

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Named aspect presets for the crop tool. `null` ratio = free. */
export const CROP_PRESETS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '2:3', ratio: 2 / 3 },
]

/**
 * Largest centred rect of `ratio` that fits in width x height (whole image
 * when ratio is null). Values are integers so the export canvas is exact.
 */
export function fitCrop(width: number, height: number, ratio: number | null): CropRect {
  if (!ratio) return { x: 0, y: 0, width, height }
  let w = width
  let h = Math.round(w / ratio)
  if (h > height) {
    h = height
    w = Math.round(h * ratio)
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h }
}

/** Clamp a rect inside the image, keeping at least a 16px square. */
export function clampCrop(c: CropRect, width: number, height: number): CropRect {
  const w = Math.max(16, Math.min(Math.round(c.width), width))
  const h = Math.max(16, Math.min(Math.round(c.height), height))
  const x = Math.max(0, Math.min(Math.round(c.x), width - w))
  const y = Math.max(0, Math.min(Math.round(c.y), height - h))
  return { x, y, width: w, height: h }
}

export function isFullCrop(c: CropRect, width: number, height: number): boolean {
  return c.x === 0 && c.y === 0 && c.width === width && c.height === height
}
