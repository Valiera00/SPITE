// Central data-retention policy. Two independent, env-configured windows, both
// enforced by the daily cleanup cron (/api/assets/cleanup):
//
//   ASSET_RETENTION_DAYS     — how long a generated result that was NEVER added
//                              to a canvas is kept before it's deleted. Anything
//                              you drag onto a canvas (used_in_canvas = true) is
//                              permanent and untouched by this. Set e.g. 30 to opt
//                              into pruning stray library results after a month.
//
//   REFERENCE_RETENTION_DAYS — how long reference *inputs* (images attached to a
//                              prompt, stored under the refs/ R2 prefix) are kept
//                              before reclaim. These are inputs, not deliverables;
//                              once gone, "Reuse" can't re-attach them. Set e.g. 7
//                              to opt into weekly reclaim.
//
// BOTH default to 0 = NEVER DELETE. Out of the box nothing is auto-removed; a
// deployment opts into each window independently by setting the env var to a
// positive number of days. Keeping the policy here (not scattered across routes)
// means the Settings page can describe exactly what will happen.

const DEFAULT_ASSET_RETENTION_DAYS = 0     // 0 = never delete (fully opt-in)
const DEFAULT_REFERENCE_RETENTION_DAYS = 0 // 0 = never delete (fully opt-in)

function parseDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

/** Days unused (non-canvas) results are kept. 0 = never expire. */
export function getAssetRetentionDays(): number {
  return parseDays(process.env.ASSET_RETENTION_DAYS, DEFAULT_ASSET_RETENTION_DAYS)
}

/** Days reference inputs (refs/ prefix) are kept. 0 = never reclaim. */
export function getReferenceRetentionDays(): number {
  return parseDays(process.env.REFERENCE_RETENTION_DAYS, DEFAULT_REFERENCE_RETENTION_DAYS)
}

/**
 * Expiry timestamp to stamp on a freshly-recorded, not-yet-on-canvas result.
 * Returns null when asset retention is disabled (0) — i.e. it never expires.
 */
export function assetExpiresAt(): Date | null {
  const days = getAssetRetentionDays()
  if (days <= 0) return null
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}
