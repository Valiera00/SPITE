// Strict validators for any fal.ai endpoint slug or request id that
// reaches user-controllable input on our generate/status, generate/cancel,
// and generate/recover routes. Without these, an attacker can pass
// `model="../@evil.example.com/path"` or similar and turn our server
// into a request-forgery primitive against fal.

const MAX_MODEL_LEN = 200
const MAX_REQUEST_ID_LEN = 64

export function isValidFalModel(model: unknown): model is string {
  if (typeof model !== 'string') return false
  if (model.length === 0 || model.length > MAX_MODEL_LEN) return false
  // No path-traversal segments. Cheaper than trying to bake it into
  // the regex and harder to get subtly wrong.
  if (model.includes('..')) return false
  // fal endpoints all start with the org slug (`fal-ai/`, sometimes
  // a vendor like `easel-ai/`) and contain only lowercase alphanumerics,
  // dashes, periods, and slashes. No `@`, no scheme, no whitespace.
  return /^[a-z0-9-]+\/[a-z0-9./-]+$/.test(model)
}

export function isValidFalRequestId(requestId: unknown): requestId is string {
  if (typeof requestId !== 'string') return false
  if (requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LEN) return false
  // fal request_ids are UUID-like — alphanumerics with hyphens.
  return /^[a-zA-Z0-9-]+$/.test(requestId)
}
