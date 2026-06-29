# Onboarding tour images

Drop screenshots / renders here to illustrate the first-time tour steps. Each
file is **optional** — if it's missing, that step simply shows its text without
an image (no errors). Replace any of them anytime without touching code.

Recommended: 16:9-ish PNG or GIF, ~1200px wide. They render at up to ~176px tall
inside the tour popover (and are the assets you can reuse for promos/social).

| File (in `public/onboarding/`) | Used in step | What to capture |
|---|---|---|
| `dashboard-welcome.png` | Dashboard · Welcome | A hero shot of SPITE — the dashboard, or a striking generated frame. |
| `canvas-overview.png` | Dashboard · "Canvas" | A populated canvas with a few connected nodes. |
| `flow-overview.png` | Dashboard · "Flow" | The Flow thread with a couple of results. |
| **`canvas-working.mp4`** | Canvas · Welcome (**video**) | A short screen-recording of working on a canvas (adding/connecting/generating). Muted, loops. `canvas-welcome.png` is the fallback if absent. |
| `canvas-welcome.png` | Canvas · Welcome (fallback) | Wide still of a canvas with nodes + cords. |
| `canvas-add-menu.png` | Canvas · Add a node | The right-click add-node menu open on the canvas. |
| `canvas-shot.png` | Canvas · Scenes & shots | A node with its **shot badge** assigned — show the **yellow glow** and where on the node you assign it. |
| `flow-welcome.png` | Flow · Welcome | The Flow compose box + a result. |
| `flow-result.png` | Flow · Reuse/Copy/Save | A result card showing the Reuse / Copy / Save actions. |
| `settings-overview.png` | Settings · Welcome | The Settings page (optional). |
| `settings-recovery.png` | Settings · Recovery | The Recovery section, and/or an asset showing its blue "recovered" badge in the asset panel. |

`.mp4` (and `.webm`) play muted + looping; everything else is a still image.

Tip: visit `/?tour=dashboard`, `/project/<id>?tour=canvas`,
`/m/project/<id>?tour=flow`, or `/settings?tour=settings` to replay any tour —
handy for capturing clean screenshots of the tour itself.
