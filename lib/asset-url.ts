// URL helpers for assets served through the /api/r2-image proxy.
//
// Both are no-ops for anything that isn't a proxy URL (blob: previews while
// an upload is in flight, absolute fal/R2 URLs on legacy rows), so callers can
// pass whatever they have without checking first.

const PROXY_PREFIX = '/api/r2-image/'

function isProxyUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith(PROXY_PREFIX)
}

/**
 * Small WebP rendition for grid tiles. The proxy generates it on first
 * request and serves it with a long private cache lifetime, so a tile costs
 * ~30KB once instead of the multi-MB original on every panel open.
 */
export function thumbUrl(url: string): string {
  if (!isProxyUrl(url) || !/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}w=384`
}

/**
 * URL that saves the file instead of opening it. `<a download>` alone is
 * ignored because the proxy redirects cross-origin to R2; this asks the proxy
 * to have R2 answer with Content-Disposition: attachment, so the browser
 * downloads in place rather than navigating to the file.
 */
export function downloadUrl(url: string, filename?: string): string {
  if (!isProxyUrl(url)) return url
  const name = encodeURIComponent(filename || '')
  return `${url}${url.includes('?') ? '&' : '?'}download=${name}`
}

/**
 * Same-origin bytes for an image the browser needs to READ, not just show —
 * the photo editor draws it onto a canvas and inspects pixels. The normal
 * proxy URL redirects to R2, and a cross-origin image taints the canvas, so
 * this asks the proxy to stream the bytes itself instead.
 */
export function bytesUrl(url: string): string {
  if (!isProxyUrl(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}bytes=1`
}

/** A readable filename stem for a downloaded asset. Extension is added server-side. */
export function assetDownloadName(asset: { id: string; type: string; model?: string | null }): string {
  const model = (asset.model || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const parts = ['spite', asset.type, model && model !== 'upload' ? model : '', asset.id.slice(0, 8)]
  return parts.filter(Boolean).join('-')
}
