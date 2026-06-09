// User preference for the animated braided cord connectors on the canvas.
// Stored in localStorage (a pure UI preference — no need to involve the DB).
//
//   'auto' (default) — every cord drifts on small canvases; on big ones
//                      (> ANIM_BUDGET edges) idle cords freeze and only the
//                      cords you hover/select animate.
//   'on'             — always animate idle cords, regardless of canvas size.
//   'off'            — never animate; fully static cords (max performance).

export type ConnectorAnimation = 'auto' | 'on' | 'off'

const KEY = 'spite_connector_animation'
export const CONNECTOR_ANIMATION_EVENT = 'spite:connector-animation'

export function getConnectorAnimation(): ConnectorAnimation {
  if (typeof window === 'undefined') return 'auto'
  const v = window.localStorage.getItem(KEY)
  return v === 'on' || v === 'off' ? v : 'auto'
}

export function setConnectorAnimation(v: ConnectorAnimation): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, v)
  // Let any open canvas in this tab react without a reload.
  window.dispatchEvent(new CustomEvent(CONNECTOR_ANIMATION_EVENT, { detail: v }))
}
