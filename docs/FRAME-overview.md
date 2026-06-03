# FRAME — Comprehensive Overview

> An internal handoff document for the marketing/positioning agent. Covers what FRAME is, every feature and why it exists, the user it was built for, the technical stack, and the current state vs. open-source ambition. Written by the implementation engineer; lean on it for facts, adapt the voice as needed for external materials.

---

## What FRAME is (the one-paragraph version)

FRAME is a **node-based visual canvas for AI filmmaking**. The user lays out their entire shoot — characters, locations, props, prompts, references, generations, shots, scenes — as draggable nodes on an infinite canvas. Connections between nodes express data flow (a prompt feeds a generator, a generated image feeds a video model as a reference, etc.). At any point the user can hit Generate on a node and FRAME orchestrates the right call to whichever fal.ai model fits, manages the result, files it in the right project, and shows it in place on the canvas. The end product is a fully sequenced visual: scenes containing shots, shots containing images and videos, all reproducible because the prompts/references that produced them are still wired in.

The closest mental model is "ComfyUI for filmmakers, not for ML engineers" — or "Figma for prompt-driven video production" — but neither is quite right. FRAME is opinionated about the creative production workflow (scenes, shots, character consistency, reference folders) in a way that pure node editors aren't.

---

## The problem it solves

AI image and video generation has a serious workflow gap once you move past "type a prompt, get a picture." Real creative production needs:

1. **Multi-step pipelines.** You generate a character image, then use it as a reference for a video. That video becomes a shot. That shot lives in a scene. Each step has its own model, settings, and prompt.
2. **Consistency across many generations.** A character has to look like the same character across 50 shots. A location has to read as the same place. Prompt repetition alone is not enough — you need typed references.
3. **Variant exploration.** "Give me 12 versions of this with slight prompt variations" needs to be one click, not 12 clicks.
4. **Asset organization.** After a day of generation you have hundreds of outputs. Which ones are takes for shot 7? Which are exploratory? Which are final?
5. **Cost visibility.** Video models are expensive. A misclick can cost $50+. Production needs guardrails.
6. **Recoverability.** When fal's queue stalls (which it does), generations seem to disappear. They actually persist on fal's side for ~24h, but most tools forget about them.

Existing tools handle pieces of this. fal.ai's playground is one prompt at a time. Krea / Leonardo / Midjourney are great for ideation but have no node graph. ComfyUI has a node graph but it's for ML practitioners and doesn't know about scenes or shots. Kling's own UI doesn't talk to other providers. **FRAME's bet is that filmmakers want one canvas that holds the whole pipeline**, across providers, with the production primitives (scenes, shots, character folders) built in.

---

## Who it's for

The primary user we built for:

- **Solo creators and small creative teams** producing short-form AI video — commercials, music videos, concept reels, narrative shorts.
- **Pre-visualization and visdev artists** at studios who need to mood-board with motion.
- **Concept-to-shortfilm pipelines** where one person plans the whole thing rather than a 30-person studio crew.

They share these traits:
- Visual thinkers who prefer node graphs to terminal commands.
- Heavy users of multiple AI providers (they don't want to be locked to one model family).
- Production-minded: they think in shots and scenes, not in prompts.
- Cost-aware: they have meaningful budgets but care deeply about not torching them by accident.

Secondary users likely to land on it once open-source:
- ComfyUI users who want a friendlier creative-focused UI.
- Educators teaching AI-assisted filmmaking who need a tool that shows the pipeline visually.
- Indie game dev / animation studios doing motion concept work.

---

## Tour: how the canvas actually works

A 60-second walkthrough an agent could use as a reference scene:

1. **Open a project.** Land on an empty canvas with a Scene 1 strip across the top.
2. **Drop a Prompt node.** Type "a cinematic wide shot of a horse galloping at sunset." Connect its output to a new **Image Generator** node, choose Nano Banana Pro.
3. **Hit Generate.** A tooltip on the button shows the cost estimate. The generated image appears in the node.
4. **Add the result to a Character folder** by right-clicking and tagging it "Elias the horse." The folder turns purple.
5. **In a new Image Generator node**, type "`@Elias` running through a forest." The `@Elias` token becomes a purple chip referencing your folder. On Generate, FRAME automatically attaches Elias's reference image to the fal call and (for citation-based models) rewrites the prompt to `@Image1 running through a forest`. The model knows what Elias looks like.
6. **Wire the output into a Video Generator** node. Choose Seedance 2.0. Set duration to 5 seconds. The Generate button tooltip now says `Estimated cost: ~$4.50`.
7. **Tag the video node as Shot 1**. It appears in the Scene 1 strip at the top.
8. **Click the Scene timeline's "+" to add Scene 2.** All the nodes you create in Scene 2 are tagged to Scene 2 — switching back to Scene 1 hides them.
9. **Repeat across scenes** until your short is laid out. The whole structure is visible.
10. **Export.** Click "Export shots" in the scene bar. A zip downloads with one folder per scene, files named `Shot 1.mp4`, `Shot 2.png` etc. preserving order.

That's the loop. Every other feature in FRAME exists to make this loop safer, faster, or more powerful.

---

## Feature catalog

This section is exhaustive — what each subsystem does and why it exists. Use the "why" framing in marketing copy: it gives the product narrative authority.

### Canvas and node editor

**Visual node graph powered by React Flow.** Infinite pan/zoom canvas. Connections (called edges) have type validation — you can't connect an image output to a video output, but you can connect an image to either a reference input or a first-frame input. The wire types are color-coded.

**Per-scene filtering.** The canvas only shows nodes belonging to the active scene. Switching scenes is instant and reversible. Nodes are visually identical regardless of scene; what differs is which scene the user is currently focused on.

**Alignment guides** (purple, semi-transparent) appear when dragging a node near another node's edges or center. Same UX pattern as Figma/Photoshop smart guides.

**Auto-arrange** button in each node's toolbar with four options: auto-fit square grid, 5 columns wide, single horizontal row, single vertical column. Useful for taming a batch of generated outputs.

**Per-node toolbar** with Run / Cancel / Duplicate / Move to scene / Delete. Most actions also have keyboard shortcuts (Ctrl+D duplicate, Delete to remove, Ctrl+Z/Y undo/redo).

**Auto-save** every 3 seconds after a change (debounced) plus a 30-second backup interval. Snapshots are kept separately (see Recovery section).

**Why these design choices:** the canvas needs to feel like a tool you can throw nodes onto and rearrange without worrying. Alignment guides + auto-arrange + per-scene filtering together mean you can have a chaotic mid-project state and clean it up in two clicks.

### Node types

- **Prompt node.** A text editor with @-mention support. Output: a text stream you can wire into Image or Video generators. Double-click to edit; drag from anywhere on the card to move. Cheap, lightweight, designed for prompt reuse.
- **Image Generator.** Lets you pick a model, set aspect ratio / resolution / batch count, and generate. Each generator can take an input image (for image-to-image), a text prompt (from a Prompt node or typed in-place), and folder references (via @-mentions). The generator's output is a generated image visible in the node.
- **Video Generator.** Same shape but for video. Plus first-frame and end-frame inputs (for image-to-video), a reference input (for multi-image conditioning on supported models), a video input (for video-to-video on supported models), duration / aspect / resolution controls, and audio generation toggles where the model supports it.
- **Reference Asset node.** A node containing an existing asset (uploaded by the user or generated earlier). Wires its image out into other generators as a reference.
- **Sticker / Comment.** Decorative nodes for marking up the canvas. Stickers are images, comments are text annotations.

### Supported AI models (current as of this writing)

**Image models:**
- Nano Banana 2 — fast, supports extreme aspect ratios, accepts multi-image references
- Nano Banana Pro — higher quality, same references support
- FLUX Schnell — cheapest, fast, text-only
- FLUX Dev — high quality, supports single image-to-image
- Kling o1 image — precise edits with multi-image reference

**Video models:**
- Seedance 2.0 — ByteDance's cinematic model. Native audio, multi-shot editing, 4-15s. Supports image-to-video and a separate reference-to-video endpoint.
- Kling 1.0 / 1.5 / 1.6 — varying quality tiers
- Kling 3.0 (standard / pro / 4K) — top-tier cinematic, native audio, supports `elements` style multi-reference conditioning
- Kling o1 video — multimodal with element references
- MiniMax Hailuo
- Luma Ray 2

The model registry is in `lib/fal-models.ts`. Adding a new model is one entry in that file plus (optionally) a price estimate in `lib/fal-cost.ts`.

### Reference system (Folders)

This is one of FRAME's strongest differentiators.

**Folders** are typed collections of related assets: Character, Prop, Location, General. Each folder type gets a color (purple = character, blue = prop, green = location, yellow = general).

**Creating a folder.** Right-click an asset → "Add to..." → choose a folder type or create a new one. The folder appears in the left sidebar and can hold any number of assets.

**Using a folder.** In any Image or Video generator's prompt, type `@FolderName`. The text becomes an inline color-coded chip. On Generate, FRAME automatically attaches every asset in that folder (or the subset you pick from the chip's popover) as a reference to fal.

**Per-asset selection.** Clicking a chip opens a tiny popover showing every asset in the folder. Click an asset thumbnail to toggle whether it's included in this specific generation. The chip remembers your selection between generations.

**Model-aware prompt rewriting.** This is the trick that makes references actually work. fal models have different reference grammars:
- Kling / Seedance want explicit citations: `@Image1 walking through @Image2`
- Nano Banana / FLUX want natural language: `the character shown in reference image 1 walking through the location shown in reference image 2`
- Kling 3.0 wants per-subject "elements" (an array)
- Models with no reference support get the bare folder name as plain text so the model still has context

FRAME picks the right strategy per model and rewrites the prompt automatically before submission. The user just writes `@Elias is riding @Bobby through the @Forest` and gets the correct payload for whatever model they chose.

### @-mention input (technical detail worth highlighting)

The textbox is a custom contentEditable component that renders folder mentions as inline chips. Survives save/load, survives folder rename, survives folder names with apostrophes or accents. Click a chip to open the asset picker. Press @ to start a new mention; type to filter folders. The interaction matches what users expect from Notion / Slack mention systems.

### Scenes and shots

**Scenes** are the top-level organizational unit. A project can have any number of scenes; each scene has a name, an order, and a set of nodes belonging to it. The scene strip across the top shows all scenes with their shot thumbnails. Click a scene to switch the canvas filter to it. Add / rename / delete scenes from the strip.

**Shots** are how the user marks "this node represents Shot N of Scene M." A node (typically a video generator) can be tagged with a shot number. The scene strip shows shots in order with thumbnails. Tagging is done via a small selector on the node.

**Gaps preserved.** If you have shots 1 and 4 but not 2 and 3, the export and scene strip both honor the gap — `Shot 1.mp4` and `Shot 4.mp4`, not `Shot 1.mp4` and `Shot 2.mp4`. The numbering is intentional, not auto-compacted. This matches how working directors think about shot lists.

**Per-scene collapse.** Each scene tile has a chevron to collapse to "just show the first shot." Useful when you have 20 scenes and want a compact strip while focusing on one.

**Auto-thumbnails.** The first shot's image becomes the scene's preview, which propagates up to the project list (see Project Management section).

### Asset library

The left sidebar holds a project-scoped library of every generation + upload + recovered asset for the current project. Filter by type (image / video / upload). Search by prompt text. Grouped by month created.

**Detail panel.** Click any asset to see metadata (model, prompt, created date, size), preview the video/image in a 480px-wide panel (recently widened from 288px because video previews were tiny), and act on it: Copy link, Download, Mark as recovered, Delete, Add to folder.

**Multi-select mode.** Click "Select" to enter selection mode. Click thumbnails to toggle, or "Select all" for everything visible. The selection toolbar offers:
- **Download** as a zip with live progress (Fetching 12/69, Zipping 47%)
- **Delete** with confirmation; canvas-used assets are protected from deletion

**Cross-project library view** is available too (no project filter). Useful when you want to find an asset you remember generating in a different project.

**Permanent vs. expiring assets.** Assets used on a canvas are permanent. Assets in folders are permanent. Everything else gets a 30-day expiry from creation. The cleanup cron isn't scheduled by default, so nothing is actually deleted today — but the schema is ready for it once the user wants to manage storage.

### Recovery system

A FRAME-specific feature that addresses a real fal pain point: jobs that get stuck or lost.

**Per-node 10-minute soft timeout.** If a generation has been polling fal without completion for 10 minutes, the node enters a "failed" state but keeps the request_id stored.

**Re-check button.** On a timed-out node, the user clicks "Re-check" → FRAME hits fal's status endpoint directly and reports back via toast ("Still in fal's queue (queue position 12). Polling resumed." or "Result is ready — saved to your library." or "fal: \<error\>"). No new fal job is submitted — just a free status check.

**Bulk recovery.** Settings page has a "Recover" button. It scans every project for nodes with stuck pending requests, asks fal about each, and pulls back any that have completed. Files them in the asset library with a blue Lifebuoy badge so you can spot which ones came back from the dead.

**Manual recovery.** If a node was deleted but the user has a fal request ID (from fal.ai/dashboard), they can POST it directly to `/api/generate/recover` and FRAME will fetch the result + file it.

**Why this exists:** fal jobs occasionally hang in queue position 0 for hours. Generation results stay on fal's side for ~24h. Without explicit recovery, those completed jobs are invisible to the user — they paid for them, they just can't access them. FRAME is the only tool we know of that systematically pulls them back.

### Canvas snapshots

Every successful save also writes a snapshot of the full node graph to a separate `canvas_snapshots` table. Throttled to one per 5 minutes per project, capped at 30 snapshots — roughly 2.5 hours of recoverable history. Restore endpoint lets the user roll back to any snapshot; the restore itself takes a pre-restore snapshot so the rollback is also undoable.

**Empty-wipe guard.** A specific failsafe: if the autosave payload contains zero nodes but the database currently has nodes, the save is rejected. Prevents a glitch, refresh race, or closed-tab beacon from accidentally wiping a working canvas.

### Cost safety

A subsystem that grew out of a real incident where the founder spent $200 in a day without realizing. Several layered defenses:

**Live fal balance badge** in the canvas toolbar. Polls `/api/fal/balance` every 30 seconds. Shows current account balance with color tinting (default → amber under $20 → red below $0). Click to refresh manually. The ambient awareness is the primary safety surface.

**Cost estimate on every Generate button.** Hover the button to see `Generate 3 videos · Estimated cost: ~$13.50 ($4.50 each). Real cost depends on resolution, duration and model load.` The estimate comes from a per-model price table in `lib/fal-cost.ts`.

**Confirm modal at $25+.** A single high-threshold gate that catches the "panic spiral" pattern (e.g., a 6x Seedance batch at $27). Below $25 there's no friction; above, one click of confirmation.

**Per-model batch counter persistence.** Image counters persist across sessions (users routinely work in batches of 6 for character/style sheets). Video counters reset to 1 every session because video models are expensive enough that bumping the count should always be conscious.

**Kill switch.** Setting `GENERATION_DISABLED=1` in Vercel env vars makes every Generate click return a clean 503. A break-glass lever in case something goes wrong.

**Staggered batch submissions.** Parallel POSTs to `/api/generate/submit` are spread 200ms apart so Vercel's edge protection doesn't reject any as a burst. Earlier the user reported 1 of 3 returning 403; staggering fixes it.

**Partial-success warnings.** If 2 of 3 submissions succeed and 1 fails, a toast says exactly what happened and what was billed: "Only 2 of 3 submissions accepted — 1 rejected (likely rate-limit). You were billed for 2."

### Export

Click "Export shots" in the scene timeline → a zip downloads containing one folder per scene, files named `Shot 1.mp4`, `Shot 4.png`, etc. preserving order numbers. Filenames are recovered from R2 keys where possible (the R2 upload timestamps are stripped).

Live progress in the button: `Fetching 12/69`, `Zipping 47%` with an animated spinner. Throttled toast updates so the queue doesn't spam. Important for 60+ video packs where the operation takes a meaningful time.

### Project management

**Projects** are the top-level container. Each project has its own canvas, scenes, asset library, folders, and shot timeline. Switching projects is a clean context boundary.

**Dashboard.** The home screen shows every project as a card with:
- A thumbnail (Shot 1's output if available, project's own thumbnail field as fallback)
- Last-edited time (live, accurate to canvas-save events — not just metadata changes)
- Project name (editable in place)
- Right-click menu: Duplicate, Delete (with typed-confirmation)

Sorted by most recently used. Search bar filters by name + description.

**Project duplication** copies the entire node graph, edges, scene structure, folders, and asset references to a new project. Useful when starting a variation of an existing concept.

**Deletion** is a typed-confirmation flow ("type the project name to confirm"). Cleanup correctly removes nodes, edges, folders, snapshots, and assets that aren't referenced by any other project.

### Authentication & security

Currently single-user with **password-protected access** via a cookie session. The password is set as `APP_PASSWORD` env var; the middleware redirects everything to a login page if the cookie isn't present.

**HMAC-signed proxy URLs** are how fal.ai fetches assets that live in the user's private R2 bucket. The signing key is `R2_PROXY_SIGNING_SECRET` (with `APP_PASSWORD` as a fallback for legacy deploys). Tokens are valid for 1 hour. The URL format encodes the token in the path so models that reject query strings still work.

**Destructive action guards:** clearing all canvas data or all assets requires the user to type a specific phrase (`DELETE ALL CANVAS DATA` / `DELETE ALL ASSETS`) before the button enables.

**Cron route** (`/api/assets/cleanup`) uses `crypto.timingSafeEqual` against a required `CRON_SECRET` and refuses to run without the secret set — closing a previous bug where unset env vars allowed unauthenticated access.

For the open-source path, the single-shared-password model would need to be replaced with real per-user auth (NextAuth / Clerk / Supabase). That's the largest blocker to true multi-tenant hosting.

---

## Technical architecture

### Stack

- **Frontend:** Next.js 16.2.6 (App Router), React 19, Tailwind v4, Phosphor Icons
- **Canvas:** @xyflow/react (React Flow v12)
- **State:** SWR for server state, local useState/useReducer for UI state
- **Database:** Neon Postgres via `@neondatabase/serverless` (HTTP driver)
- **Storage:** Cloudflare R2 (S3-compatible) accessed via `@aws-sdk/client-s3`
- **AI:** fal.ai REST API via `@fal-ai/client` and direct fetch calls
- **Deployment:** Vercel (Next.js + Edge middleware)
- **ZIP builder:** JSZip (client-side, for downloads and exports)

### Services

- **fal.ai** for every AI generation (BYOK — user provides their own key)
- **Cloudflare R2** for asset storage (BYOK — user provides their own bucket)
- **Neon** for canvas state, scenes, asset metadata, folder structure (BYOK — user provides their own DB URL)
- **Vercel** for hosting (BYOK — user deploys their own copy)

### Environment variables (current minimum set)

- `FAL_KEY` — user's fal.ai API key
- `DATABASE_URL` — Neon connection string
- `APP_PASSWORD` — the single shared password
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2
- `R2_PROXY_SIGNING_SECRET` — HMAC key for proxy URL signing
- `CRON_SECRET` — for the cleanup cron (when scheduled)
- `NEXT_PUBLIC_SITE_URL` — used for CORS allow-list and absolute URLs
- `GENERATION_DISABLED` — optional kill switch
- `ALLOWED_ORIGINS` — optional override for R2 bucket CORS

### Data model (simplified)

- `projects` — id, name, description, thumbnail, createdat, updatedat
- `canvas_nodes` — projectId, nodeId, type, position_x, position_y, data (JSONB)
- `canvas_edges` — projectId, edgeId, source, target, sourceHandle, targetHandle, animated
- `canvas_snapshots` — id, project_id, saved_at, nodes_json, edges_json
- `generation_history` — id, type, model, prompt, r2_url, used_in_canvas, is_upload, recovered, created_at, expires_at, project_id
- `asset_folders` + `asset_folder_items` — folder definitions and membership
- `assets` — separate table for user-uploaded reference files (older schema; coexists with generation_history)

Schema additions (`recovered` column, snapshot tables) are added idempotently at runtime via `ALTER TABLE IF NOT EXISTS` patterns — no manual migration scripts needed.

---

## Current state vs. open-source plan

### What FRAME is today

A **single-user app** the founder uses every day for real client work. Password-protected, deployed on Vercel + Neon + R2, billed against the founder's personal fal.ai account. Stable and feature-rich; the technical debt that exists is mostly in the auth model and the lack of multi-tenancy.

### What goes open-source

The plan is **BYOK self-host**: anyone clones the repo, fills in their own fal/Neon/R2/Vercel keys, and deploys their own private copy. No hosted SaaS for now. This avoids the multi-tenancy refactor, billing infrastructure, and compliance surface area.

Estimated time to ship the open-source-ready version: ~1 afternoon of focused work on documentation, an `.env.example`, a README with screenshots, and removing the test-endpoint scaffold left over from v0. The code itself is already in good shape.

### What would unlock hosted SaaS later

If demand justifies it, the SaaS path needs:
- Real per-user authentication (NextAuth / Clerk / Supabase)
- Multi-tenant data model (add `user_id` to every table, scope every query)
- Per-user storage isolation in R2 (key prefixes)
- Rate limiting (Upstash/Redis-backed)
- Billing infrastructure (Stripe + usage metering, or per-user BYOK)
- ToS, privacy policy, GDPR review

Roughly a month of focused product work to do well. Not in scope for now.

---

## Differentiators (for positioning)

What makes FRAME different from the alternatives a marketer might compare against:

| Tool | What it does well | What FRAME does differently |
|------|------------------|------------------------------|
| **fal.ai playground** | One prompt, fast feedback | FRAME orchestrates fal across a whole project, not a single call |
| **ComfyUI** | Powerful node graph for ML control | FRAME is for creatives, not engineers — opinionated about scenes/shots/references instead of generic node primitives |
| **Krea / Leonardo / Midjourney** | Beautiful generation UIs | FRAME holds the whole pipeline — image → video → shot → scene — not just generation |
| **Kling / Runway native UIs** | Polished single-provider tools | FRAME spans providers (Seedance + Kling + Nano Banana + FLUX + …) in one canvas |
| **Figma** | Best-in-class visual canvas, but no AI | FRAME's "Figma for AI filmmaking" idea — canvas + generation + production primitives |
| **Premiere Pro / Resolve** | Edit final footage | FRAME is what happens *before* editing — the generation and pre-vis pipeline |

The strongest differentiating ideas:
1. **Multi-model orchestration with consistent reference handling.** No other creative-facing tool we've seen automatically rewrites prompts to match each model's reference grammar.
2. **Production-aware primitives.** Scenes and shots are first-class, not retrofitted.
3. **Recoverability.** No other tool we know of systematically pulls back stuck/lost generations from fal.
4. **Cost-aware UX.** Estimates on every button, live balance display, kill switch, staggered submissions. Built by someone who actually lost $200 to a runaway and decided that should never happen again.

---

## Roadmap and known limitations

### Likely near-term work

- **Image editing** (crop, flip, draw, simple filters) directly in FRAME, with the edited result saved back to R2 as a new asset. Would unlock "fix this generation slightly without re-generating it" workflows.
- **Spend velocity warnings.** Sticky banner when spend exceeds N dollars in a 5-minute window. Pairs with the existing balance badge for a complete cost-awareness picture.
- **Per-model "trusted" toggles** — explicitly mark a model as "don't bother me with confirms" for power users.
- **Better fal balance endpoint discovery.** The current `/api/fal/balance` tries a few known URL shapes; should be updated as fal evolves its API.

### Open issues worth flagging

- The single-shared-password model is the largest UX/security debt. Fine for personal use, blocking for multi-user.
- Polling cadence is fixed at 2s; could be backed off for jobs older than N minutes.
- The 480px asset detail panel is still a fixed width; a resizable/popout video preview would help review workflows.
- Cleanup cron isn't scheduled — assets accumulate forever. Needs a `vercel.json` cron config when the user is ready.
- No structured logging — diagnostics rely on `console.log/error` scattered through routes. Worth wrapping when scaling.

### What we deliberately don't ship

- **AI features inside FRAME other than generation orchestration.** No auto-tagging, no automatic prompt rewriting beyond reference-grammar translation, no in-app prompt generation. Users come for control, not magic.
- **Built-in video editing.** FRAME is pre-production. Once shots are generated, users go to Premiere / Resolve / CapCut.
- **Real-time multi-user collaboration.** Out of scope for the single-user open-source path.

---

## Glossary

- **Canvas** — the visual editor with nodes and connections
- **Node** — an item on the canvas (generator, prompt, reference, sticker, comment)
- **Edge** — a connection between two node handles
- **Scene** — a project subdivision; nodes belong to exactly one scene at a time
- **Shot** — a numbered position in a scene; nodes can be tagged as shots
- **Folder** — typed collection of reference assets (Character / Prop / Location / General)
- **Mention** — an `@FolderName` token in a prompt that references a folder
- **Chip** — the visual rendering of a mention as a colored inline tag
- **Reference** — an asset attached to a generation as additional model input
- **Generation** — a single fal job (one fal request_id)
- **Batch** — multiple parallel fal jobs from one Generate click
- **Recovery** — pulling back a generation that completed at fal but was lost from FRAME
- **Snapshot** — a saved point-in-time copy of a project's canvas

---

## Tone and voice suggestions

Some phrases that emerged organically during development that might be worth borrowing for external copy:

- "ComfyUI for filmmakers, not for ML engineers."
- "A visual canvas for AI filmmaking."
- "Multi-model orchestration with consistent reference handling."
- "Generation-safe by default."
- "Cost-aware from the first click."
- "Scenes, shots, characters — the primitives filmmakers actually think in."
- "Built by someone who lost $200 to a misclick and decided that should never happen again."

What the product is *not*, which a positioning agent should resist drifting toward:

- ❌ "An AI assistant for filmmakers" — too generic, undersells the canvas
- ❌ "The fastest AI video tool" — speed isn't the differentiator; orchestration is
- ❌ "Magical AI filmmaking" — magical-marketing language conflicts with the engineering rigor under the hood
- ❌ "No-code video production" — accurate but boring; the canvas is the point

---

## Closing context for the marketing agent

FRAME exists because the founder couldn't find anything that held the whole AI filmmaking pipeline in one place. Everything that's here was added because some specific workflow demanded it. The recovery system exists because real Seedance jobs got stuck. The cost safeguards exist because a real $200 day happened. The folder/mention system exists because keeping character consistency across 50 shots is impossible without it. The 480px video preview exists because the founder couldn't review motion in a 162px box.

Lean into that origin story when it helps — it explains the rigor of the engineering and the practicality of the features. Avoid romanticizing it; this is a real working tool, not a vision deck.

Last technical note: the codebase is well-commented (the engineer who built it leaves rationale notes everywhere, including in this document). When the open-source community lands, the docs in `lib/` and `app/api/` will carry most of the onboarding load.
