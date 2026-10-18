// Shared shape for model makers' own APIs (BytePlus for Seedance, Alibaba
// Model Studio for Wan), used instead of fal when chosen in Settings → Model
// providers. Each provider maps SPITE's settings onto its own API and its task
// states onto fal's vocabulary, so the node, polling and recovery code is the
// same whichever route a job took. See lib/model-routing.ts for the choice.

export type PricingProvider = 'fal' | 'byteplus' | 'alibaba' | 'alibaba-sg'

export interface DirectTaskInput {
  prompt: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceAudioUrls?: string[]
  /** SPITE's value: "auto", "adaptive" or a ratio like "16:9". */
  aspectRatio?: string
  /** SPITE's value: "auto" or whole seconds as a string. */
  duration?: string
  /** SPITE's value, e.g. "1080p". */
  resolution?: string
  generateAudio?: boolean
}

export interface DirectTask {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  videoUrl?: string
  error?: string
}

export interface DirectProvider {
  id: 'byteplus' | 'alibaba'
  /** Shown to the user: "BytePlus", "Alibaba Model Studio". */
  label: string
  /** Pseudo-endpoint prefix stored on the node in place of a fal queue path. */
  prefix: string
  /** Settings it reads: pasted in Settings, or environment variables. */
  envVars: string[]
  configured(): Promise<boolean>
  /** Why it isn't usable, when configured() is false. */
  missingConfig(): string
  /** The provider's model id for a SPITE model, or null if it doesn't serve it. */
  modelFor(spiteId: string): string | null
  /** Which price table applies (Alibaba's depends on the region). */
  pricingId(): Promise<PricingProvider>
  isValidEndpoint(endpoint: unknown): endpoint is string
  isValidTaskId(id: unknown): id is string
  create(model: string, input: DirectTaskInput): Promise<string>
  get(id: string): Promise<DirectTask>
  cancel(id: string): Promise<void>
}

export class ProviderError extends Error {
  constructor(message: string, readonly providerLabel: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ProviderError'
  }
  /**
   * Failures that mean "this route is unavailable", not "this request is bad":
   * unreachable, server error, bad/expired key, model not activated. The
   * submit route falls back to fal on these. A 400 (invalid parameter, a face
   * filtered, …) would fail identically on fal, so it is surfaced instead.
   */
  get routeUnavailable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 401 || this.status === 403 || this.status === 404
  }
}

/** Plain-language reason a direct job had to go to fal instead. */
export function describeUnavailable(err: ProviderError): string {
  const code = err.code ? ` (${err.code})` : ''
  const who = err.providerLabel
  if (err.status === 0) return `${who} was unreachable`
  if (err.status === 401 || err.status === 403) return `${who} rejected the API key, or the model isn't enabled on the account${code}`
  if (err.status === 404) return `the model isn't activated on your ${who} account, or its id changed${code}`
  return `${who} had a server error (${err.status})${code}`
}

/** Model-id override from an env var, e.g. BYTEPLUS_MODEL_SEEDANCE_2_5. */
export function modelOverride(prefix: string, spiteId: string): string | undefined {
  const key = prefix + spiteId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const v = process.env[key]?.trim()
  return v && /^[a-z0-9][a-z0-9.-]{2,80}$/.test(v) ? v : undefined
}
