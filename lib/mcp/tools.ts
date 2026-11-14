// The tools SPITE's MCP endpoint offers. Each one goes through the same code
// the app's own buttons use: generation is submitted, polled and cancelled
// through the /api/generate routes (so the spend gate, provider routing and
// library recording all apply unchanged), and folder references are compiled
// by the same function the image and video nodes use.
//
// What is deliberately absent: anything that deletes, anything that changes
// settings, anything that reads a key.

import { NextRequest } from 'next/server'
import { POST as submitGeneration } from '@/app/api/generate/submit/route'
import { GET as generationStatus } from '@/app/api/generate/status/route'
import { POST as cancelGeneration } from '@/app/api/generate/cancel/route'
import { GET as foldersGet } from '@/app/api/folders/route'
import { getDb } from '../db'
import { getImageModels, getVideoModels, getModelById, type ModelConfig } from '../fal-models'
import { estimateGenerationCost } from '../fal-cost'
import { compileMentionsForModel, pickRefStrategy, type FolderType } from '../mention-prompt'
import { resolveRoute } from '../model-routing'
import { isThumbnailable } from '../r2-upload'
import { getOrCreateThumbnail, imageSize, renderPreview } from '../thumbnails'
import { labelFromPrompt } from '../auto-name'
import { getMcpHourlyLimitUsd } from './access'
import {
  activeBrief, addDraft, claimJobForCheck, createJob, finishJob, getJobs, keepDrafts, listDrafts,
  mcpSpendLastHourUsd, releaseJob, returnToBrief, startBrief, takeFromBrief,
  type Brief, type Draft, type Job, type Kind,
} from './store'

// ---------------------------------------------------------------------------
// Result plumbing
// ---------------------------------------------------------------------------

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface ToolResult {
  content: Content[]
  isError?: boolean
}

/** A problem the caller can act on. Its message is returned to Claude as the tool's error. */
class ToolError extends Error {}

const text = (value: unknown): Content => ({
  type: 'text',
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 1),
})

type Args = Record<string, unknown>

function str(args: Args, key: string, required = true): string | undefined {
  const v = args[key]
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolError(`"${key}" is required.`)
    return undefined
  }
  if (typeof v !== 'string') throw new ToolError(`"${key}" must be text.`)
  return v.trim()
}

function int(args: Args, key: string, min: number, max: number, fallback?: number): number {
  const v = args[key]
  if (v === undefined || v === null) {
    if (fallback === undefined) throw new ToolError(`"${key}" is required.`)
    return fallback
  }
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`"${key}" must be a whole number from ${min} to ${max}.`)
  return n
}

function intList(args: Args, key: string, max: number): number[] {
  const v = args[key]
  if (!Array.isArray(v) || v.length === 0) throw new ToolError(`"${key}" must be a list of draft numbers.`)
  const out = Array.from(new Set(v.map(Number)))
  if (out.length > max || out.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new ToolError(`"${key}" must be up to ${max} draft numbers.`)
  }
  return out
}

function jobIdList(args: Args, required: boolean): string[] | undefined {
  const v = args.job_ids
  if (v === undefined || v === null) {
    if (required) throw new ToolError('"job_ids" is required.')
    return undefined
  }
  if (!Array.isArray(v) || v.length === 0 || v.length > 40 || v.some((j) => typeof j !== 'string')) {
    throw new ToolError('"job_ids" must be a list of up to 40 job ids.')
  }
  return v as string[]
}

// Prices are shown exactly (to a hundredth of a cent) and never rounded DOWN:
// a brief's ceiling gets set from these figures, so a shown price below the
// real one would make the brief refuse the very thing it was written for.
const usd = (n: number) => {
  const up = Math.ceil(n * 10_000 - 1e-6) / 10_000
  return `$${up.toFixed(4).replace(/0{1,2}$/, '')}`
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireProject(args: Args): Promise<{ id: string; name: string; mode: string }> {
  const id = str(args, 'project_id')!
  if (!UUID.test(id)) throw new ToolError('Unknown project_id. Call list_projects for the ids.')
  const rows = await getDb()`SELECT id, name, COALESCE(origin, 'canvas') AS origin FROM projects WHERE id = ${id} LIMIT 1`
  if (rows.length === 0) throw new ToolError('Unknown project_id. Call list_projects for the ids.')
  return { id: String(rows[0].id), name: String(rows[0].name), mode: rows[0].origin === 'canvas' ? 'canvas' : 'flow' }
}

interface Folder {
  id: string
  name: string
  type: FolderType
  description: string | null
  assets: { id: string; r2_url: string; type: string }[]
}

// Same tag rule as the @-mention box in the app (lib/mention-prompt.ts).
const tagFromName = (name: string) => name.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '')

async function projectFolders(projectId: string): Promise<Folder[]> {
  const res = await foldersGet(new NextRequest(`http://spite.internal/api/folders?projectId=${encodeURIComponent(projectId)}`))
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(data)) throw new ToolError('Could not read this project’s folders. Try again.')
  return (data as Folder[]).map((f) => ({
    ...f,
    // References are images; a folder's video or audio can't ride along.
    assets: (f.assets || []).filter((a) => a.type === 'image' && !!a.r2_url),
  }))
}

const PROXY_PREFIX = '/api/r2-image/'
function r2KeyOf(url: string): string | null {
  if (!url.startsWith(PROXY_PREFIX)) return null
  try {
    return decodeURIComponent(url.slice(PROXY_PREFIX.length).split('?')[0])
  } catch {
    return null
  }
}

interface Picture {
  content: Content
  /** Shape of the image, e.g. "9:16". */
  shape: string
  /** Pixel size of the original. Known only for the large view. */
  pixels?: string
}

const COMMON_SHAPES: [string, number][] = [
  ['21:9', 21 / 9], ['2:1', 2], ['16:9', 16 / 9], ['3:2', 1.5], ['4:3', 4 / 3], ['5:4', 1.25], ['1:1', 1],
  ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['9:16', 9 / 16], ['1:2', 0.5], ['9:21', 9 / 21],
]
function shapeOf(width: number, height: number): string {
  const r = width / height
  const near = COMMON_SHAPES.find(([, v]) => Math.abs(r - v) / v < 0.025)
  return near ? near[0] : `${r >= 1 ? r.toFixed(2) + ':1' : '1:' + (1 / r).toFixed(2)}`
}

/** A stored image as something Claude can look at, with its shape. Null for video, or when it can’t be read. */
async function pictureOf(url: string, size: 'small' | 'large' = 'small'): Promise<Picture | null> {
  const key = r2KeyOf(url)
  if (!key || !isThumbnailable(key)) return null
  if (size === 'large') {
    const p = await renderPreview(key, 1280)
    if (!p) return null
    return {
      content: { type: 'image', data: p.data.toString('base64'), mimeType: 'image/jpeg' },
      shape: shapeOf(p.width, p.height),
      pixels: `${p.width}x${p.height}`,
    }
  }
  const webp = await getOrCreateThumbnail(key)
  if (!webp) return null
  // The thumbnail keeps the original's proportions, so its shape is the image's.
  const dims = await imageSize(webp)
  return {
    content: { type: 'image', data: webp.toString('base64'), mimeType: 'image/webp' },
    shape: dims ? shapeOf(dims.width, dims.height) : 'unknown',
  }
}

async function imageOf(url: string, size: 'small' | 'large' = 'small'): Promise<Content | null> {
  return (await pictureOf(url, size))?.content ?? null
}

// What is on a project’s board that can be looked at or used as an input: every
// node holding an image, clip or sound, plus how the nodes are wired together.
// Read straight from the saved canvas, which trails the open one by a few
// seconds of autosave.
interface BoardItem {
  nodeId: string
  kind: 'image' | 'video' | 'audio'
  made: 'generated' | 'reference'
  label: string
  /** The label is just the first words of the prompt, not a name someone gave it. */
  labelIsAuto: boolean
  prompt?: string
  modelId?: string
  sceneId?: string
  url: string
  /** A still that stands for a clip. */
  posterUrl?: string
  settings: Record<string, string | boolean>
  folders: string[]
  /** When the node was put on the board, and when it last generated. */
  addedAt?: string
  generatedAt?: string
  position: { x: number; y: number }
}

interface Wire { from: string; role: string }

interface Board {
  items: BoardItem[]
  byId: Map<string, BoardItem>
  /** Text of prompt nodes, which feed generators through a wire. */
  promptText: Map<string, string>
  /** What is wired INTO each node, and what each node feeds. */
  inputs: Map<string, Wire[]>
  feeds: Map<string, string[]>
}

const usableUrl = (v: unknown): string | undefined =>
  typeof v === 'string' && (v.startsWith(PROXY_PREFIX) || /^https?:\/\//.test(v)) ? v : undefined

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

async function loadBoard(projectId: string): Promise<Board> {
  const sql = getDb()
  const [rows, edges] = await Promise.all([
    sql`SELECT nodeId AS id, type, position_x, position_y, data FROM canvas_nodes WHERE projectId = ${projectId}::text ORDER BY nodeId`,
    sql`SELECT source, target, targethandle FROM canvas_edges WHERE projectId = ${projectId}::text`,
  ])
  const items: BoardItem[] = []
  const promptText = new Map<string, string>()
  const typeOf = new Map<string, string>()
  for (const r of rows) {
    const id = String(r.id)
    const d = (r.data || {}) as Record<string, unknown>
    typeOf.set(id, String(r.type))
    if (r.type === 'prompt') {
      if (typeof d.text === 'string' && d.text.trim()) promptText.set(id, d.text.trim())
      continue
    }
    // Same order the canvas itself uses to decide what a node holds (lib/node-media.ts).
    const url = usableUrl(d.outputUrl) ?? usableUrl(d.assetUrl) ?? usableUrl(d.thumbnail) ?? usableUrl(d.imageUrl)
    if (!url) continue
    const byName = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? 'video' : /\.(mp3|wav|m4a|ogg|flac)(\?|$)/i.test(url) ? 'audio' : null
    const kind: BoardItem['kind'] =
      r.type === 'videoGen' ? 'video'
      : d.mediaType === 'video' || d.mediaType === 'audio' ? d.mediaType
      : byName ?? 'image'
    const generated = r.type === 'imageGen' || r.type === 'videoGen'
    const prompt = typeof d.prompt === 'string' && d.prompt.trim() ? d.prompt.trim() : undefined
    const label = typeof d.label === 'string' ? d.label.trim() : ''
    const settings: Record<string, string | boolean> = {}
    if (generated) {
      for (const [key, name] of [['aspectRatio', 'aspect_ratio'], ['resolution', 'resolution'], ['quality', 'quality'], ['duration', 'duration']] as const) {
        if (typeof d[key] === 'string' && d[key]) settings[name] = d[key] as string
      }
      if (r.type === 'videoGen' && typeof d.enableAudio === 'boolean') settings.sound = d.enableAudio
    }
    // Node ids start with the moment they were created.
    const born = /^[a-z]+-(\d{13})/.exec(id)
    items.push({
      nodeId: id,
      kind,
      made: generated ? 'generated' : 'reference',
      label,
      labelIsAuto: generated && !!prompt && !!label && label === labelFromPrompt(prompt),
      prompt,
      modelId: generated && typeof d.modelId === 'string' ? d.modelId : undefined,
      sceneId: typeof d.sceneId === 'string' ? d.sceneId : undefined,
      url,
      posterUrl: kind === 'video' ? usableUrl(d.videoThumbnail) : undefined,
      settings,
      folders: Array.isArray(d.mentions)
        ? (d.mentions as { name?: unknown }[]).map((m) => (typeof m?.name === 'string' ? m.name : '')).filter(Boolean)
        : [],
      addedAt: born ? stamp(Number(born[1])) : undefined,
      generatedAt: typeof d.submittedAt === 'number' && d.submittedAt > 0 ? stamp(d.submittedAt) : undefined,
      position: { x: Math.round(Number(r.position_x) || 0), y: Math.round(Number(r.position_y) || 0) },
    })
  }
  // Oldest first, so "the last one" is at the end.
  items.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '') || a.nodeId.localeCompare(b.nodeId))

  const inputs = new Map<string, Wire[]>()
  const feeds = new Map<string, string[]>()
  for (const e of edges) {
    const source = String(e.source), target = String(e.target)
    const handle = String(e.targethandle || '')
    const role =
      handle === 'end-frame-in' ? 'end_frame'
      : handle === 'reference-in' ? 'reference'
      : handle === 'video-in' ? 'source_video'
      : handle === 'audio-in' ? 'audio'
      : handle === 'prompt-in' || typeOf.get(source) === 'prompt' ? 'prompt'
      : typeOf.get(target) === 'videoGen' ? 'first_frame'
      : 'input_image'
    inputs.set(target, [...(inputs.get(target) || []), { from: source, role }])
    feeds.set(source, [...(feeds.get(source) || []), target])
  }
  return { items, byId: new Map(items.map((b) => [b.nodeId, b])), promptText, inputs, feeds }
}

const boardItems = async (projectId: string): Promise<BoardItem[]> => (await loadBoard(projectId)).items

const LIST_PROMPT = 160

/** One line of the board listing: enough to tell nodes apart; view_node has the rest. */
const boardLine = (b: BoardItem, board: Board) => {
  const from = (board.inputs.get(b.nodeId) || []).filter((w) => w.role !== 'prompt').map((w) => w.from)
  return {
    node_id: b.nodeId,
    kind: b.kind,
    made: b.made,
    ...(b.label && !b.labelIsAuto ? { label: b.label } : {}),
    ...(b.prompt ? { prompt: b.prompt.length > LIST_PROMPT ? b.prompt.slice(0, LIST_PROMPT) + '…' : b.prompt } : {}),
    ...(b.modelId ? { model: b.modelId } : {}),
    ...(typeof b.settings.aspect_ratio === 'string' ? { aspect_ratio: b.settings.aspect_ratio } : {}),
    ...(b.generatedAt || b.addedAt ? { when: b.generatedAt || b.addedAt } : {}),
    ...(from.length ? { made_from: from } : {}),
  }
}

/** Everything known about one node. */
const boardDetail = (b: BoardItem, board: Board) => {
  const wires = board.inputs.get(b.nodeId) || []
  const describe = (id: string) => {
    const n = board.byId.get(id)
    return n ? { node_id: id, kind: n.kind, ...(n.label && !n.labelIsAuto ? { label: n.label } : {}) } : { node_id: id, note: 'no longer holds media' }
  }
  const wiredPrompts = wires.filter((w) => w.role === 'prompt').map((w) => board.promptText.get(w.from)).filter((t): t is string => !!t)
  const madeFrom = wires.filter((w) => w.role !== 'prompt').map((w) => ({ as: w.role, ...describe(w.from) }))
  const feeds = (board.feeds.get(b.nodeId) || []).map(describe)
  return {
    node_id: b.nodeId,
    kind: b.kind,
    made: b.made,
    ...(b.label ? { label: b.label, ...(b.labelIsAuto ? { label_note: 'automatic: the first words of the prompt' } : {}) } : {}),
    ...(b.prompt ? { prompt: b.prompt } : {}),
    ...(wiredPrompts.length ? { prompt_nodes_wired_in: wiredPrompts, prompt_note: 'Wired prompt text is sent ahead of the node’s own prompt.' } : {}),
    ...(b.modelId ? { model: b.modelId } : {}),
    ...(Object.keys(b.settings).length ? { settings: b.settings } : {}),
    ...(b.folders.length ? { folders_referenced: b.folders } : {}),
    ...(madeFrom.length ? { made_from: madeFrom } : b.made === 'generated' ? { made_from: 'nothing wired in (prompt only)' } : {}),
    ...(feeds.length ? { used_by: feeds } : {}),
    ...(b.addedAt ? { added_to_board: b.addedAt } : {}),
    ...(b.generatedAt ? { last_generated: b.generatedAt } : {}),
    position_on_board: b.position,
  }
}

const allModels = (): ModelConfig[] => [...getImageModels(), ...getVideoModels()]

const takesText = (m: ModelConfig) => m.inputTypes.includes('text')
const takesImage = (m: ModelConfig) => m.inputTypes.includes('image')
const takesVideo = (m: ModelConfig) => m.inputTypes.includes('video')
const promptOptional = (m: ModelConfig) => !takesText(m) || !!m.optionalPrompt
/** Models that can't run from text alone: they animate, rework or upscale an image. */
const needsImage = (m: ModelConfig) =>
  takesImage(m) && (!takesText(m) || takesVideo(m) || /image-to-video/.test(m.falModel))

/** Whose price list applies: the maker's own API when Settings routes the model there, else fal. */
async function pricingProvider(model: ModelConfig) {
  const route = await resolveRoute(model.id)
  return route.kind === 'direct' ? await route.provider.pricingId() : ('fal' as const)
}

interface PriceOptions { resolution?: string; quality?: string; durationSeconds?: number; audio?: boolean; autoDuration?: boolean }

/** Estimated price of ONE output at these settings. Null when SPITE has no price for the model. */
async function priceOf(model: ModelConfig, o: PriceOptions = {}): Promise<number | null> {
  const e = estimateGenerationCost(model, { count: 1, ...o, provider: await pricingProvider(model) })
  return e.isKnown ? e.perUnit : null
}

const briefView = (b: Brief) => ({
  summary: b.summary,
  images_left: Math.max(0, b.maxImages - b.usedImages),
  videos_left: Math.max(0, b.maxVideos - b.usedVideos),
  models: b.models ?? 'any',
  max_price_per_image: b.maxPricePerImage === null ? 'none set' : usd(b.maxPricePerImage),
  max_price_per_video: b.maxPricePerVideo === null ? 'none set' : usd(b.maxPricePerVideo),
  valid_until: b.expiresAt,
})

const draftView = (d: Draft) => ({
  draft: d.number,
  kind: d.type,
  state: d.state,
  model: d.modelId,
  prompt: d.prompt,
  made: d.createdAt,
})

const VIDEO_NOTE = 'is a video. It can’t be previewed here; the user can watch it in the project’s library in SPITE.'

const kindOf = (job: Job): Kind => (getModelById(job.modelId)?.category === 'video' ? 'video' : 'image')

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  run: (args: Args) => Promise<Content[]>
}

const projectIdProp = { type: 'string', description: 'Project id from list_projects.' }
const readOnly = { readOnlyHint: true, openWorldHint: false }

const TOOLS: ToolDef[] = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'The projects in this SPITE, most recently edited first. Start here to find the project_id the other tools need.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
    run: async () => {
      const rows = await getDb()`
        SELECT id, name, COALESCE(origin, 'canvas') AS origin, updatedat FROM projects ORDER BY updatedat DESC LIMIT 200
      `
      if (rows.length === 0) return [text('There are no projects yet. Create one in SPITE first.')]
      return [text(rows.map((r) => ({
        project_id: r.id,
        name: r.name,
        mode: r.origin === 'canvas' ? 'canvas' : 'flow',
        last_edited: new Date(r.updatedat as string).toISOString().slice(0, 10),
      })))]
    },
  },

  {
    name: 'get_project',
    title: 'Project overview',
    description:
      'One project at a glance: what is on its board, its reference folders (each usable in a prompt as its @Tag), the brief currently agreed, ' +
      'and the drafts and running jobs you have in it. Use view_board to see the board itself.',
    inputSchema: { type: 'object', properties: { project_id: projectIdProp }, required: ['project_id'], additionalProperties: false },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const [folders, brief, drafts, jobs, board] = await Promise.all([
        projectFolders(project.id), activeBrief(project.id), listDrafts(project.id), getJobs(project.id), boardItems(project.id),
      ])
      const count = (st: Draft['state']) => drafts.filter((d) => d.state === st).length
      const onBoard = (k: BoardItem['kind']) => board.filter((b) => b.kind === k).length
      return [text({
        name: project.name,
        mode: project.mode,
        board: { images: onBoard('image'), videos: onBoard('video'), sounds: onBoard('audio'), see: 'view_board' },
        folders: folders.map((f) => ({
          tag: `@${tagFromName(f.name)}`,
          name: f.name,
          kind: f.type,
          ...(f.description ? { about: f.description } : {}),
          images: f.assets.length,
        })),
        brief: brief ? briefView(brief) : 'none agreed yet',
        // Only what was made through this connection; the board counts above are everything.
        your_drafts: { not_kept: count('draft'), kept_waiting_for_board: count('kept'), kept_and_on_board: count('on_board') },
        jobs_running: jobs.filter((j) => j.state === 'running').length,
      })]
    },
  },

  {
    name: 'view_folder',
    title: 'Look inside a folder',
    description: 'Shows the reference images in one of a project’s folders, so prompts can describe what is really there.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        folder: { type: 'string', description: 'The folder’s @Tag or name, as listed by get_project.' },
        max_images: { type: 'integer', minimum: 1, maximum: 8, description: 'How many to show. Default 4.' },
      },
      required: ['project_id', 'folder'],
      additionalProperties: false,
    },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const wanted = str(args, 'folder')!.replace(/^@/, '').toLowerCase()
      const max = int(args, 'max_images', 1, 8, 4)
      const folders = await projectFolders(project.id)
      const folder = folders.find((f) => tagFromName(f.name).toLowerCase() === wanted || f.name.toLowerCase() === wanted)
      if (!folder) {
        throw new ToolError(`No folder matches "${args.folder}". Folders: ${folders.map((f) => `@${tagFromName(f.name)}`).join(', ') || 'none'}.`)
      }
      const out: Content[] = [text({
        tag: `@${tagFromName(folder.name)}`, kind: folder.type, images: folder.assets.length,
        ...(folder.description ? { about: folder.description } : {}),
      })]
      for (const a of folder.assets.slice(0, max)) {
        const img = await imageOf(a.r2_url)
        if (img) out.push(img)
      }
      return out
    },
  },

  {
    name: 'view_board',
    title: 'Look at the board',
    description:
      'What is on a project’s board: every node holding an image, clip or sound, oldest first, with its node_id, prompt (shortened), model, when it was made and which nodes it was made from. ' +
      'This is the user’s existing work, whoever made it. A node_id can be used as an input to the generate tools (input_image, first_frame, end_frame, source_video, reference_images). ' +
      'Set show_images to see them, each captioned with its shape; clips show their poster frame. view_node gives one node’s full prompt, settings and wiring. Results are paged.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        kind: { type: 'string', enum: ['image', 'video', 'audio', 'all'], description: 'Default all.' },
        made: { type: 'string', enum: ['generated', 'reference', 'all'], description: 'Generated in SPITE, or brought in as a reference. Default all.' },
        search: { type: 'string', description: 'Only nodes whose label or full prompt contains this text.' },
        limit: { type: 'integer', minimum: 1, maximum: 60, description: 'How many to list. Default 30.' },
        offset: { type: 'integer', minimum: 0, description: 'Skip this many, to page through a large board. Default 0.' },
        show_images: { type: 'boolean', description: 'Include pictures of the listed nodes (up to 30 per call). Default false.' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const kind = str(args, 'kind', false) || 'all'
      if (!['image', 'video', 'audio', 'all'].includes(kind)) throw new ToolError('"kind" must be image, video, audio or all.')
      const made = str(args, 'made', false) || 'all'
      if (!['generated', 'reference', 'all'].includes(made)) throw new ToolError('"made" must be generated, reference or all.')
      const search = (str(args, 'search', false) || '').toLowerCase()
      const limit = int(args, 'limit', 1, 60, 30)
      const offset = int(args, 'offset', 0, 100_000, 0)
      const board = await loadBoard(project.id)
      const all = board.items.filter((b) =>
        (kind === 'all' || b.kind === kind) &&
        (made === 'all' || b.made === made) &&
        (!search || b.label.toLowerCase().includes(search) || (b.prompt || '').toLowerCase().includes(search)))
      if (all.length === 0) return [text(search || kind !== 'all' || made !== 'all' ? 'Nothing on the board matches that.' : 'This board has no images, clips or sounds yet.')]
      const page = all.slice(offset, offset + limit)
      const out: Content[] = [text({
        total: all.length,
        showing: `${Math.min(offset + 1, all.length)}-${Math.min(offset + page.length, all.length)}`,
        order: 'oldest first',
        ...(offset + page.length < all.length ? { more: `offset ${offset + page.length} for the next page` } : {}),
        ...(page.some((b) => (b.prompt || '').length > LIST_PROMPT) ? { note: 'Prompts are shortened here. view_node has the full prompt, settings and wiring.' } : {}),
        nodes: page.map((b) => boardLine(b, board)),
      })]
      if (args.show_images === true) {
        const PICTURES = 30
        for (const b of page.slice(0, PICTURES)) {
          const pic = b.kind === 'image' ? await pictureOf(b.url) : b.posterUrl ? await pictureOf(b.posterUrl) : null
          if (!pic) continue
          const caption = [b.nodeId, pic.shape !== 'unknown' ? pic.shape : '', b.kind === 'video' ? 'poster frame of a clip' : '', b.label && !b.labelIsAuto ? `"${b.label}"` : '']
          out.push(text(caption.filter(Boolean).join(' \u00b7 ')), pic.content)
        }
        if (page.length > PICTURES) out.push(text(`Pictures shown for the first ${PICTURES} only; page with offset for the rest.`))
      }
      return out
    },
  },

  {
    name: 'view_node',
    title: 'Look at a board node',
    description:
      'Everything about one node on the board: its full prompt (and any prompt nodes wired into it), model and settings, which nodes it was made from and which use it, when it was made, ' +
      'and the picture with its pixel size and shape. For a clip the picture is the poster frame; the clip itself can’t be watched here. Use it to match or build on earlier work exactly.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        node_id: { type: 'string', description: 'A node_id from view_board.' },
        size: { type: 'string', enum: ['small', 'large', 'none'], description: 'Picture size, or none for the details only. Default large.' },
      },
      required: ['project_id', 'node_id'],
      additionalProperties: false,
    },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const nodeId = str(args, 'node_id')!
      const sizeArg = str(args, 'size', false) || 'large'
      if (!['small', 'large', 'none'].includes(sizeArg)) throw new ToolError('"size" must be small, large or none.')
      const board = await loadBoard(project.id)
      const node = board.byId.get(nodeId)
      if (!node) throw new ToolError(`No node "${nodeId}" with an image, clip or sound on this board. Call view_board for the ids.`)
      const detail = boardDetail(node, board)
      if (sizeArg === 'none') return [text(detail)]
      const source = node.kind === 'image' ? node.url : node.posterUrl
      const pic = source ? await pictureOf(source, sizeArg as 'small' | 'large') : null
      if (!pic) {
        return [text(detail), text(node.kind === 'image' ? 'This image can’t be shown here.' : 'This one has no picture to show here; the user can play it in SPITE.')]
      }
      const picture = {
        shape: pic.shape,
        ...(pic.pixels ? { pixels: pic.pixels } : {}),
        ...(node.kind === 'video' ? { of: 'the clip’s poster frame, which may be smaller than the clip' } : {}),
      }
      return [text({ ...detail, picture }), pic.content]
    },
  },

  {
    name: 'list_models',
    title: 'List models',
    description:
      'The image and video models this SPITE can generate with: their options, what inputs they take, and what one output costs. ' +
      'Use it to propose a brief with real prices. Video is priced per second unless it says per clip: one clip costs the per-second price times its length, ' +
      'and each per-second model also lists the price of a clip at its default length. Set a brief’s price ceilings at or above these exact figures.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['image', 'video', 'all'], description: 'Default all.' } },
      additionalProperties: false,
    },
    annotations: readOnly,
    run: listModels,
  },

  {
    name: 'agree_brief',
    title: 'Record the agreed brief',
    description:
      'Records what the user has agreed you may do in a project: how many images and/or videos, optionally with which models and up to what price each. ' +
      'SPITE enforces it; the generate tools refuse anything outside it. ' +
      'Call this ONLY after the user has explicitly approved this exact brief in the conversation. Propose it first, with prices from list_models, and wait for a yes. ' +
      'To go beyond a brief (more tries, a pricier model or setting, longer clips), ask the user and record a new one; a new brief replaces the old. A brief lasts 12 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        summary: { type: 'string', description: 'The brief in the words the user agreed to, e.g. "Up to 8 stills of the rooftop shot on Nano Banana Pro at 2K, then 2 five-second clips on Kling 4.0 Flash".' },
        max_images: { type: 'integer', minimum: 0, maximum: 200, description: 'Most images you may generate under this brief. Default 0.' },
        max_videos: { type: 'integer', minimum: 0, maximum: 50, description: 'Most videos you may generate under this brief. Default 0.' },
        models: { type: 'array', items: { type: 'string' }, description: 'Model ids allowed. Omit to allow any model.' },
        max_price_per_image: { type: 'number', minimum: 0, description: 'Highest price in USD for one image. Omit for no cap beyond SPITE’s own limits.' },
        max_price_per_video: { type: 'number', minimum: 0, description: 'Highest price in USD for one whole clip (price per second times length). Omit for no cap beyond SPITE’s own limits.' },
      },
      required: ['project_id', 'summary'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args) => {
      const project = await requireProject(args)
      const summary = str(args, 'summary')!.slice(0, 600)
      const maxImages = int(args, 'max_images', 0, 200, 0)
      const maxVideos = int(args, 'max_videos', 0, 50, 0)
      if (maxImages + maxVideos === 0) throw new ToolError('A brief needs max_images or max_videos above 0.')
      let models: string[] | null = null
      if (args.models !== undefined && args.models !== null) {
        if (!Array.isArray(args.models) || args.models.some((m) => typeof m !== 'string')) throw new ToolError('"models" must be a list of model ids.')
        const known = new Set(allModels().map((m) => m.id))
        const unknown = (args.models as string[]).filter((m) => !known.has(m))
        if (unknown.length) throw new ToolError(`Unknown model id: ${unknown.join(', ')}. Call list_models.`)
        models = (args.models as string[]).length ? Array.from(new Set(args.models as string[])) : null
      }
      const cap = (key: string): number | null => {
        if (args[key] === undefined || args[key] === null) return null
        const n = Number(args[key])
        if (!Number.isFinite(n) || n < 0) throw new ToolError(`"${key}" must be a price in USD.`)
        return n
      }
      const brief = await startBrief({
        projectId: project.id, summary, maxImages, maxVideos, models,
        maxPricePerImage: cap('max_price_per_image'), maxPricePerVideo: cap('max_price_per_video'),
      })
      return [text({ recorded: true, project: project.name, brief: briefView(brief) })]
    },
  },

  {
    name: 'generate_images',
    title: 'Generate images',
    description:
      'Starts image generations in a project, inside the agreed brief. Each image is its own job and costs money. ' +
      'Results are DRAFTS: they go to the project’s library, not onto the board. The user picks which to keep (keep_drafts). ' +
      'Images can be given as inputs, each either a draft number or a board node_id from view_board: input_image is the picture to rework or upscale, ' +
      'reference_images are extra pictures to draw on (on models that take several). Folder references are written as @Tag in the prompt. ' +
      'Returns job ids at once; results come from check_jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        prompt: { type: 'string', description: 'What to make. May include @Tag folder references. Not needed for upscalers.' },
        model: { type: 'string', description: 'Image model id from list_models.' },
        count: { type: 'integer', minimum: 1, maximum: 8, description: 'How many separate tries. Default 1.' },
        aspect_ratio: { type: 'string', description: 'One of the model’s aspect ratios. Default: the model’s own.' },
        resolution: { type: 'string', description: 'One of the model’s resolutions (for upscalers: 2x or 4x). Default: the model’s own.' },
        quality: { type: 'string', description: 'One of the model’s qualities, for models that have them.' },
        input_image: { type: ['integer', 'string'], description: 'The image to work from: a draft number or a board node_id.' },
        reference_images: { type: 'array', maxItems: 10, items: { type: ['integer', 'string'] }, description: 'More images to draw on, as draft numbers or board node_ids. They come after input_image and before any @Tag folders: refer to them in the prompt as "reference image 2", "reference image 3" and so on.' },
      },
      required: ['project_id', 'model'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (args) => generate('image', args),
  },

  {
    name: 'generate_videos',
    title: 'Generate videos',
    description:
      'Starts video generations in a project, inside the agreed brief. Each clip is its own job; video costs far more than images, so be exact about length and resolution. ' +
      'Results are DRAFTS in the project’s library; the user picks which to keep (keep_drafts). You cannot watch video: tell the user to review clips in SPITE. ' +
      'Inputs are each a draft number or a board node_id from view_board: first_frame and end_frame are images the clip starts and ends on, ' +
      'reference_images are pictures of characters or things to keep consistent (on models with folder_references), source_video is a clip for upscalers and video-to-video models. ' +
      'Folder references are written as @Tag in the prompt. list_models says what each model takes. ' +
      'Returns job ids at once; clips take from under a minute to several minutes (check_jobs).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        prompt: { type: 'string', description: 'What happens in the shot. May include @Tag folder references.' },
        model: { type: 'string', description: 'Video model id from list_models.' },
        count: { type: 'integer', minimum: 1, maximum: 4, description: 'How many separate tries. Default 1.' },
        duration: { type: 'string', description: 'One of the model’s durations, e.g. "5s" (or "auto" where offered). Default: the model’s own.' },
        aspect_ratio: { type: 'string', description: 'One of the model’s aspect ratios. Default: the model’s own.' },
        resolution: { type: 'string', description: 'One of the model’s resolutions. Default: the model’s own.' },
        sound: { type: 'boolean', description: 'Generate sound, on models that can. Default false. May change the price.' },
        first_frame: { type: ['integer', 'string'], description: 'Image the clip starts from: a draft number or a board node_id.' },
        end_frame: { type: ['integer', 'string'], description: 'Image the clip ends on: a draft number or a board node_id.' },
        reference_images: { type: 'array', maxItems: 10, items: { type: ['integer', 'string'] }, description: 'Reference pictures, as draft numbers or board node_ids. They come before any @Tag folders. On models that cite references, name them in the prompt in the order given: @Image1, @Image2 (Seedance, Wan, Veo) or @Element1, @Element2 (Kling).' },
        source_video: { type: ['integer', 'string'], description: 'A clip to work from, for models that take one: a video draft number or a board node_id.' },
      },
      required: ['project_id', 'model'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (args) => generate('video', args),
  },

  {
    name: 'check_jobs',
    title: 'Check jobs',
    description:
      'Progress of generation jobs. Finished results get a draft number, and finished images are shown. ' +
      'With no job_ids it covers everything still running in the project plus what finished in the last 15 minutes. ' +
      'Images usually take 10–60 seconds and video one to several minutes; wait_seconds lets this call wait for results instead of you calling repeatedly.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        job_ids: { type: 'array', items: { type: 'string' }, description: 'Specific jobs. Omit for all recent ones.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: 40, description: 'Wait up to this long for running jobs to finish. Default 20.' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: checkJobs,
  },

  {
    name: 'cancel_jobs',
    title: 'Cancel jobs',
    description:
      'Asks to stop jobs that are still running, e.g. a clip started with the wrong settings. Usually only a job that has not begun rendering can be stopped. ' +
      'A stopped job gives its try back to the brief. Finished results are never affected.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        job_ids: { type: 'array', items: { type: 'string' }, description: 'Jobs to stop.' },
      },
      required: ['project_id', 'job_ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: cancelJobs,
  },

  {
    name: 'list_drafts',
    title: 'List drafts',
    description:
      'The images and videos you have made in a project, by draft number. state "draft" = in the library only, "kept" = waiting to appear on the board, "on_board" = placed. ' +
      'Set show_images to look at the image drafts again.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        state: { type: 'string', enum: ['draft', 'kept', 'on_board', 'all'], description: 'Which drafts. Default all.' },
        show_images: { type: 'boolean', description: 'Include the images (the newest 12 that match). Default false.' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const state = str(args, 'state', false) || 'all'
      if (!['draft', 'kept', 'on_board', 'all'].includes(state)) throw new ToolError('"state" must be draft, kept, on_board or all.')
      const all = await listDrafts(project.id)
      const drafts = state === 'all' ? all : all.filter((d) => d.state === state)
      if (drafts.length === 0) return [text(state === 'all' ? 'No drafts in this project yet.' : `No drafts in state "${state}".`)]
      const out: Content[] = [text(drafts.map(draftView))]
      if (args.show_images === true) {
        for (const d of drafts.filter((x) => x.type === 'image').slice(-12)) {
          const img = await imageOf(d.url)
          if (img) out.push(text(`Draft ${d.number}`), img)
        }
      }
      return out
    },
  },

  {
    name: 'view_draft',
    title: 'Look at a draft',
    description: 'Shows one image draft, small or large. Use large to judge detail before recommending what to keep. Video drafts can’t be shown.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        draft: { type: 'integer', minimum: 1, description: 'Draft number.' },
        size: { type: 'string', enum: ['small', 'large'], description: 'Default large.' },
      },
      required: ['project_id', 'draft'],
      additionalProperties: false,
    },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const number = int(args, 'draft', 1, 1_000_000)
      const size = str(args, 'size', false) === 'small' ? 'small' : 'large'
      const [draft] = await listDrafts(project.id, { numbers: [number] })
      if (!draft) throw new ToolError(`There is no draft ${number} in this project (it may have been cleared from the library).`)
      if (draft.type === 'video') return [text(draftView(draft)), text(`Draft ${draft.number} ${VIDEO_NOTE}`)]
      const img = await imageOf(draft.url, size)
      return img ? [text(draftView(draft)), img] : [text(draftView(draft)), text('This draft can’t be shown as an image here.')]
    },
  },

  {
    name: 'keep_drafts',
    title: 'Keep drafts',
    description:
      'Puts drafts the user chose onto the project’s board. Call it only for drafts the user said to keep. ' +
      'They appear as nodes the next time the project’s canvas is open in SPITE (within seconds if it is open now), and stop counting down toward library cleanup. ' +
      'Nothing is removed by this: drafts that aren’t kept simply stay in the library.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        drafts: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Draft numbers to keep.' },
      },
      required: ['project_id', 'drafts'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args) => {
      const project = await requireProject(args)
      const numbers = intList(args, 'drafts', 50)
      const found = await listDrafts(project.id, { numbers })
      const missing = numbers.filter((n) => !found.some((d) => d.number === n))
      if (missing.length) throw new ToolError(`No such draft in this project: ${missing.join(', ')}. Nothing was kept.`)
      await keepDrafts(project.id, numbers)
      const already = found.filter((d) => d.state === 'on_board').map((d) => d.number)
      return [text({
        kept: numbers,
        ...(already.length ? { already_on_board: already } : {}),
        note: project.mode === 'canvas'
          ? 'They will appear on the board when the project’s canvas is open in SPITE.'
          : 'This is a Flow project with no board; the drafts are kept in its library and no longer expire.',
      })]
    },
  },
]

// ---------------------------------------------------------------------------
// list_models
// ---------------------------------------------------------------------------

async function listModels(args: Args): Promise<Content[]> {
  const kind = str(args, 'kind', false) || 'all'
  if (!['image', 'video', 'all'].includes(kind)) throw new ToolError('"kind" must be image, video or all.')
  const refs: Record<string, string> = {
    'citation-flat': 'several', 'citation-elements': 'several', multi: 'several', single: 'one', none: 'none',
  }
  const show = (p: number | null) => (p === null ? 'unknown' : usd(p))
  const out: Record<string, unknown>[] = []
  for (const m of allModels()) {
    if (kind !== 'all' && m.category !== kind) continue
    const tiers = m.resolutions?.length ? m.resolutions : [undefined]
    const common = {
      model: m.id,
      name: m.name,
      kind: m.category,
      about: m.description,
      ...(m.aspectRatios.length ? { aspect_ratios: m.aspectRatios } : {}),
      ...(m.resolutions?.length ? { resolutions: m.resolutions, default_resolution: m.defaultResolution } : {}),
      prompt: !takesText(m) ? 'not used' : m.optionalPrompt ? 'optional' : 'required',
      folder_references: takesText(m) ? refs[pickRefStrategy(m)] : 'none',
    }
    if (m.category === 'image') {
      const table = async (q?: string) => {
        const row: Record<string, string> = {}
        for (const r of tiers) row[r ?? 'any size'] = show(await priceOf(m, { resolution: r, quality: q }))
        return row
      }
      let price: Record<string, unknown>
      if (m.qualities?.length) {
        price = {}
        for (const q of m.qualities) price[q] = await table(q)
      } else price = await table()
      out.push({
        ...common,
        ...(m.qualities?.length ? { qualities: m.qualities, default_quality: m.defaultQuality } : {}),
        input_image: !takesImage(m) ? 'no' : needsImage(m) ? 'required (based_on_draft)' : 'optional (based_on_draft)',
        price_per_image: price,
      })
      continue
    }
    // Per second when the price moves with length, else per clip.
    const perSecond = (await priceOf(m, { durationSeconds: 1 })) !== (await priceOf(m, { durationSeconds: 2 }))
    const table = async (audio: boolean) => {
      const row: Record<string, string> = {}
      for (const r of tiers) row[r ?? 'any size'] = show(await priceOf(m, { resolution: r, durationSeconds: 1, audio }))
      return row
    }
    const silent = await table(false)
    // The whole-clip price at the model's default length, priced the way a job is.
    const defaultSeconds = Number.parseInt(m.defaultDuration || '', 10) || 0
    const clipTable = async () => {
      const row: Record<string, string> = {}
      for (const r of tiers) row[r ?? 'any size'] = show(await priceOf(m, { resolution: r, durationSeconds: defaultSeconds, audio: false }))
      return row
    }
    const withSound = m.supportsAudio ? await table(true) : null
    const provider = await pricingProvider(m)
    const notes: string[] = []
    if (m.referenceModel && !m.referenceTakesFrames) notes.push('Folder references and first/end frames are separate modes: use one or the other.')
    if (m.referenceParam === 'elements' && !m.referenceModel) notes.push('Folder references need a first frame.')
    out.push({
      ...common,
      ...(m.durations?.length ? { durations: m.durations, default_duration: m.defaultDuration } : {}),
      sound: m.supportsAudio ? 'optional (sound: true)' : 'no setting',
      first_frame: !takesImage(m) ? 'no' : needsImage(m) ? 'required' : 'optional',
      end_frame: takesImage(m) && !takesVideo(m) ? 'optional' : 'no',
      source_video: takesVideo(m) ? 'required' : 'no',
      ...(notes.length ? { notes } : {}),
      [perSecond ? 'price_per_second' : 'price_per_clip']:
        withSound && JSON.stringify(withSound) !== JSON.stringify(silent) ? { without_sound: silent, with_sound: withSound } : silent,
      ...(perSecond && defaultSeconds ? { [`price_of_a_${defaultSeconds}s_clip`]: await clipTable() } : {}),
      ...(provider !== 'fal' ? { billed_by: 'the model maker’s own API (Settings → Model providers)' } : {}),
    })
  }
  return [text(out)]
}

// ---------------------------------------------------------------------------
// generate_images / generate_videos
// ---------------------------------------------------------------------------

async function generate(kind: Kind, args: Args): Promise<Content[]> {
  const project = await requireProject(args)
  const noun = kind === 'video' ? 'video' : 'image'
  const modelId = str(args, 'model')!
  const count = int(args, 'count', 1, kind === 'video' ? 4 : 8, 1)

  const model = allModels().find((m) => m.id === modelId)
  if (!model) throw new ToolError(`Unknown model "${modelId}". Call list_models.`)
  if (model.category !== kind) {
    throw new ToolError(`${model.name} is ${model.category === 'video' ? 'a video' : 'an image'} model. Use generate_${model.category}s for it.`)
  }

  const prompt = str(args, 'prompt', false) || ''
  if (prompt.length > 8000) throw new ToolError('The prompt is too long (8000 characters at most).')
  if (!prompt && !promptOptional(model)) throw new ToolError(`${model.name} needs a prompt.`)
  if (prompt && !takesText(model)) throw new ToolError(`${model.name} doesn’t take a prompt. Leave "prompt" out.`)

  const pick = (key: string, options: string[] | undefined, fallback: string | undefined, label: string) => {
    const v = str(args, key, false)
    if (!v) return fallback || undefined
    if (!options?.length) throw new ToolError(`${model.name} has no ${label} setting. Leave "${key}" out.`)
    if (!options.includes(v)) throw new ToolError(`${model.name} doesn’t offer ${label} "${v}". Options: ${options.join(', ')}.`)
    return v
  }
  const aspectRatio = pick('aspect_ratio', model.aspectRatios, model.defaultAspectRatio, 'aspect ratio')
  const resolution = pick('resolution', model.resolutions, model.defaultResolution, 'resolution')
  const quality = kind === 'image' ? pick('quality', model.qualities, model.defaultQuality, 'quality') : undefined
  const duration = kind === 'video' ? pick('duration', model.durations, model.defaultDuration, 'duration') : undefined
  let sound = false
  if (kind === 'video' && args.sound !== undefined && args.sound !== null) {
    if (typeof args.sound !== 'boolean') throw new ToolError('"sound" must be true or false.')
    if (args.sound && !model.supportsAudio) throw new ToolError(`${model.name} has no sound setting. Leave "sound" out.`)
    sound = args.sound
  }

  // The brief is the user's standing yes. No brief, no generation.
  const brief = await activeBrief(project.id)
  if (!brief) {
    throw new ToolError(
      'No brief is agreed for this project (or the last one ran out after 12 hours). ' +
      'Propose one to the user with prices, and once they approve, call agree_brief.',
    )
  }
  if (brief.models && !brief.models.includes(model.id)) {
    throw new ToolError(`The agreed brief allows only: ${brief.models.join(', ')}. Ask the user before using ${model.name}, then record a new brief.`)
  }
  const price = await priceOf(model, {
    resolution, quality,
    durationSeconds: duration && duration !== 'auto' ? Number.parseInt(duration, 10) || undefined : undefined,
    autoDuration: duration === 'auto',
    audio: kind === 'video' ? sound : undefined,
  })
  if (price === null) throw new ToolError(`SPITE has no price on record for ${model.name}, so it won’t run it.`)
  const cap = kind === 'video' ? brief.maxPricePerVideo : brief.maxPricePerImage
  if (cap !== null && price > cap + 1e-9) {
    throw new ToolError(
      `One ${noun} at these settings is about ${usd(price)}, over the ${usd(cap)} per ${noun} in the agreed brief. ` +
      'Pick a cheaper setting, or ask the user and record a new brief.',
    )
  }
  const left = kind === 'video' ? brief.maxVideos - brief.usedVideos : brief.maxImages - brief.usedImages
  if (count > left) {
    throw new ToolError(
      left > 0
        ? `The agreed brief has ${left} ${noun}${left === 1 ? '' : 's'} left, and this asks for ${count}. Ask for fewer, or ask the user for more and record a new brief.`
        : `The agreed brief has no ${noun}s left. Ask the user whether to continue, then record a new brief.`,
    )
  }
  // The owner's own ceiling for this connection, from Settings. Stated as a
  // limit, never as a running total.
  const hourly = await getMcpHourlyLimitUsd()
  if ((await mcpSpendLastHourUsd()) + price * count > hourly + 1e-9) {
    throw new ToolError(
      'This would go over the hourly limit set for Claude in SPITE’s Settings. ' +
      `Ask for fewer or cheaper ${noun}s, wait a while, or the user can raise it in Settings → Claude connection.`,
    )
  }

  // Inputs: each is a draft number or the id of a node on the board. What the
  // model can take is checked before anything is looked up, so the answer is
  // about the model, not about one particular draft or node. The *_draft names
  // are the first version's and still work.
  const arg = (...keys: string[]) => keys.map((k) => args[k]).find((v) => v !== undefined && v !== null && v !== '')
  const imageKey = kind === 'video' ? 'first_frame' : 'input_image'
  const imageArg = kind === 'video' ? arg('first_frame', 'first_frame_draft') : arg('input_image', 'based_on_draft')
  const endArg = kind === 'video' ? arg('end_frame', 'end_frame_draft') : undefined
  const videoArg = kind === 'video' ? arg('source_video', 'source_video_draft') : undefined
  const refArgs = args.reference_images
  if (refArgs !== undefined && refArgs !== null && (!Array.isArray(refArgs) || refArgs.length > 10)) {
    throw new ToolError('"reference_images" must be a list of up to 10 draft numbers or board node_ids.')
  }
  const refList: unknown[] = Array.isArray(refArgs) ? refArgs : []
  if ((imageArg !== undefined || endArg !== undefined || refList.length > 0) && !takesImage(model)) {
    throw new ToolError(`${model.name} can’t take an input image.`)
  }
  if (needsImage(model) && imageArg === undefined && !(kind === 'image' && refList.length > 0)) {
    throw new ToolError(`${model.name} works from an image: pass "${imageKey}".`)
  }
  if (kind === 'video') {
    if (endArg !== undefined && takesVideo(model)) throw new ToolError(`${model.name} has no end frame. Leave "end_frame" out.`)
    if (videoArg !== undefined && !takesVideo(model)) throw new ToolError(`${model.name} doesn’t take a video. Leave "source_video" out.`)
    if (takesVideo(model) && videoArg === undefined) throw new ToolError(`${model.name} works from a video: pass "source_video".`)
    if (refList.length > 0 && !model.referenceParam) {
      throw new ToolError(`${model.name} can’t use reference images. Use "first_frame", or pick a model whose folder_references isn’t "none".`)
    }
  }

  interface Input { from: string; url: string }
  let board: BoardItem[] | null = null
  const resolveInput = async (value: unknown, key: string, want: 'image' | 'video'): Promise<Input> => {
    const a = (t: string) => (t === 'video' ? 'a video' : t === 'audio' ? 'a sound' : 'an image')
    const asNumber = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : null
    if (asNumber !== null) {
      if (!Number.isInteger(asNumber) || asNumber < 1) throw new ToolError(`"${key}": ${asNumber} isn’t a draft number.`)
      const [draft] = await listDrafts(project.id, { numbers: [asNumber] })
      if (!draft) throw new ToolError(`There is no draft ${asNumber} in this project.`)
      if (draft.type !== want) throw new ToolError(`Draft ${asNumber} is ${a(draft.type)}; "${key}" needs ${a(want)}.`)
      return { from: `draft ${asNumber}`, url: draft.url }
    }
    if (typeof value !== 'string' || !value.trim()) throw new ToolError(`"${key}" must be a draft number or a board node_id.`)
    board = board ?? (await boardItems(project.id))
    const node = board.find((b) => b.nodeId === value.trim())
    if (!node) throw new ToolError(`"${key}": there is no node "${value}" with media on this board. Call view_board for the ids.`)
    if (node.kind !== want) throw new ToolError(`Node "${node.nodeId}" is ${a(node.kind)}; "${key}" needs ${a(want)}.`)
    return { from: `node ${node.nodeId}`, url: node.url }
  }
  const first = imageArg !== undefined ? await resolveInput(imageArg, imageKey, 'image') : undefined
  const end = endArg !== undefined ? await resolveInput(endArg, 'end_frame', 'image') : undefined
  const sourceVideo = videoArg !== undefined ? await resolveInput(videoArg, 'source_video', 'video') : undefined
  const refs: Input[] = []
  for (const r of refList) refs.push(await resolveInput(r, 'reference_images', 'image'))

  // How the inputs map onto the model, mirroring the nodes. On an image node
  // every wired image is a peer: the first is the input image and the rest ride
  // along where the model takes several. On a video node the first frame is its
  // own input and wired references come before folder references.
  let primary = first
  let extras = refs
  if (kind === 'image') {
    const every = [...(first ? [first] : []), ...refs]
    primary = every[0]
    extras = every.slice(1)
    const takesSeveral = model.imageParam === 'image_urls' || !!model.referenceParam
    if (extras.length > 0 && !takesSeveral) {
      throw new ToolError(`${model.name} accepts one input image, and ${every.length} were given. Give one, or pick a model whose folder_references is "several".`)
    }
  }
  const slotsAhead = kind === 'video'
    ? extras.length
    : model.imageParam === 'image_urls' ? (primary ? 1 : 0) + extras.length : primary ? 1 : 0

  // @Tag references, compiled exactly as the nodes do it.
  const folders = prompt ? await projectFolders(project.id) : []
  const tags = Array.from(prompt.matchAll(/@([\w-]+)/g), (m) => m[1])
  const byTag = new Map(folders.map((f) => [tagFromName(f.name).toLowerCase(), f]))
  const unknownTags = Array.from(new Set(tags.filter((t) => !byTag.has(t.toLowerCase()))))
  if (unknownTags.length) {
    throw new ToolError(
      `No folder matches ${unknownTags.map((t) => `@${t}`).join(', ')}. ` +
      `This project’s folders: ${folders.map((f) => `@${tagFromName(f.name)}`).join(', ') || 'none'}.`,
    )
  }
  const emptyTags = Array.from(new Set(tags.filter((t) => byTag.get(t.toLowerCase())!.assets.length === 0)))
  if (emptyTags.length) throw new ToolError(`These folders have no images to reference: ${emptyTags.map((t) => `@${t}`).join(', ')}.`)
  const compiled = compileMentionsForModel(prompt, [], folders, model, slotsAhead)
  const refGroups = [...extras.map((x) => ({ urls: [x.url] })), ...compiled.refGroups]
  const hasRefs = refGroups.length > 0
  const notes: string[] = []
  if (tags.length && compiled.strategy === 'none') {
    notes.push(`${model.name} can’t use reference images, so the folders were sent as plain names only.`)
  } else if (tags.length && compiled.strategy === 'single') {
    notes.push(`${model.name} takes one reference image, so only the first folder’s first image was sent.`)
  }
  if (kind === 'video' && hasRefs) {
    // The same two rules the video node enforces before it lets a job go.
    if (model.referenceModel && !model.referenceTakesFrames && (primary || end)) {
      throw new ToolError(
        `${model.name} can’t use a first/end frame and reference images in the same clip: they are separate modes. ` +
        'Drop the references to keep the exact frame, or drop the frame to use the references.',
      )
    }
    if (model.referenceParam === 'elements' && !model.referenceModel && !primary) {
      throw new ToolError(`${model.name} needs a first frame to use reference images: pass "first_frame".`)
    }
  }

  if (!(await takeFromBrief(brief.id, kind, count))) {
    throw new ToolError('The agreed brief no longer has room for this (it changed a moment ago). Call get_project to see what is left.')
  }

  const body = JSON.stringify({
    modelId: model.id,
    prompt: compiled.prompt,
    referenceImageUrl: primary?.url,
    endImageUrl: end?.url,
    referenceGroups: hasRefs ? refGroups : undefined,
    settings: kind === 'video'
      ? { aspectRatio, duration, resolution, enableAudio: sound, enableLoop: false, videoUrl: sourceVideo?.url }
      : { aspectRatio, resolution, quality, numImages: 1 },
  })

  // One job per output, never overlapping — the same pacing the nodes use.
  const jobs: string[] = []
  let failure: string | null = null
  let actualPrice = price
  for (let i = 0; i < count; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 300))
    let data: Record<string, unknown> = {}
    let ok = false
    try {
      const res = await submitGeneration(new NextRequest('http://spite.internal/api/generate/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      }))
      data = ((await res.json().catch(() => ({}))) || {}) as Record<string, unknown>
      ok = res.ok && typeof data.request_id === 'string'
    } catch (err) {
      console.error('[mcp] submit threw:', err instanceof Error ? err.message : err)
    }
    if (!ok) {
      failure = typeof data.error === 'string' ? data.error.slice(0, 500) : 'SPITE could not start the job.'
      await returnToBrief(brief.id, kind, count - i) // this one and the rest never started
      break
    }
    if (typeof data.estimatedUsd === 'number') actualPrice = data.estimatedUsd
    // Meant for the maker's own API but ran on fal (key missing, provider down).
    if (typeof data.fallbackReason === 'string' && !notes.some((n) => n.startsWith('Ran on fal'))) {
      notes.push(`Ran on fal instead of ${typeof data.fallbackFrom === 'string' ? data.fallbackFrom : 'the maker’s API'}: ${data.fallbackReason}. Price per ${noun} is about ${usd(actualPrice)}.`)
    }
    jobs.push(await createJob({
      projectId: project.id,
      briefId: brief.id,
      requestId: String(data.request_id),
      pollModel: String(data.model),
      modelId: model.id,
      prompt,
      settings: {
        aspectRatio, resolution, quality, duration,
        ...(kind === 'video' ? { enableAudio: sound } : {}),
        ...(primary ? { from: primary.from } : {}),
        ...(end ? { endFrame: end.from } : {}),
        ...(extras.length ? { references: extras.map((x) => x.from) } : {}),
        ...(sourceVideo ? { sourceVideo: sourceVideo.from } : {}),
      },
      estimatedUsd: actualPrice,
    }))
  }

  if (jobs.length === 0) throw new ToolError(`Nothing was started. ${failure}`)
  const after = await activeBrief(project.id)
  return [text({
    started: jobs.length,
    job_ids: jobs,
    model: model.name,
    [`price_per_${noun}`]: usd(actualPrice),
    brief_left: after
      ? { images: Math.max(0, after.maxImages - after.usedImages), videos: Math.max(0, after.maxVideos - after.usedVideos) }
      : { images: 0, videos: 0 },
    ...(failure ? { stopped_early: `Only ${jobs.length} of ${count} started. ${failure}` } : {}),
    ...(notes.length ? { notes } : {}),
    next: kind === 'video' ? 'Call check_jobs for the results; clips can take a few minutes.' : 'Call check_jobs for the results.',
  })]
}

// ---------------------------------------------------------------------------
// check_jobs
// ---------------------------------------------------------------------------

interface JobReport {
  job_id: string
  state: string
  drafts?: number[]
  error?: string
  note?: string
}

/** One status check of one running job. Returns null when another check holds it. */
async function checkOne(job: Job): Promise<{ report: JobReport; newDrafts: number[] } | null> {
  if (!(await claimJobForCheck(job.id))) return null
  try {
    const q = new URLSearchParams({ request_id: job.requestId, model: job.pollModel, projectId: job.projectId, prompt: job.prompt || 'Generated asset' })
    const res = await generationStatus(new NextRequest(`http://spite.internal/api/generate/status?${q.toString()}`))
    const data = ((await res.json().catch(() => ({}))) || {}) as {
      status?: string; error?: string; output?: { images?: string[]; videos?: string[]; url?: string }
    }
    if (data.status === 'FAILED') {
      const error = (typeof data.error === 'string' ? data.error : 'Generation failed').slice(0, 400)
      await finishJob(job.id, 'failed', error)
      await returnToBrief(job.briefId, kindOf(job), 1) // a failed try doesn't use up the brief
      return { report: { job_id: job.id, state: 'failed', error }, newDrafts: [] }
    }
    if (data.status === 'COMPLETED') {
      const out = data.output
      const urls = out?.images?.length ? out.images : out?.videos?.length ? out.videos : out?.url ? [out.url] : []
      const numbers: number[] = []
      for (const url of urls) {
        // The status route has just recorded each result in the library; find
        // the row it made so the draft points at a real asset.
        const rows = await getDb()`
          SELECT id FROM generation_history WHERE project_id = ${job.projectId} AND r2_url = ${url}
          ORDER BY created_at DESC LIMIT 1
        `
        if (rows.length) numbers.push(await addDraft(job.projectId, String(rows[0].id), job.id))
      }
      await finishJob(job.id, 'done', numbers.length ? undefined : 'finished, but the result could not be saved to the library')
      return numbers.length
        ? { report: { job_id: job.id, state: 'done', drafts: numbers }, newDrafts: numbers }
        : { report: { job_id: job.id, state: 'done', note: 'It finished, but the result could not be saved to the library.' }, newDrafts: [] }
    }
    await releaseJob(job.id)
    if (!res.ok) return { report: { job_id: job.id, state: 'running', note: 'Could not check it just now; try again.' }, newDrafts: [] }
    return { report: { job_id: job.id, state: data.status === 'IN_QUEUE' ? 'queued' : 'running' }, newDrafts: [] }
  } catch (err) {
    await releaseJob(job.id)
    console.error('[mcp] status check threw:', err instanceof Error ? err.message : err)
    return { report: { job_id: job.id, state: 'running', note: 'Could not check it just now; try again.' }, newDrafts: [] }
  }
}

async function checkJobs(args: Args): Promise<Content[]> {
  const project = await requireProject(args)
  const ids = jobIdList(args, false)
  const wait = int(args, 'wait_seconds', 0, 40, 20)
  const deadline = Date.now() + wait * 1000

  const jobs = await getJobs(project.id, ids)
  if (jobs.length === 0) return [text(ids ? 'None of those jobs belong to this project.' : 'No jobs are running, and none finished in the last 15 minutes.')]

  const reports = new Map<string, JobReport>()
  const fresh: number[] = []
  for (const j of jobs) {
    if (j.state === 'failed') reports.set(j.id, { job_id: j.id, state: 'failed', error: j.error || 'Generation failed' })
    if (j.state === 'cancelled') reports.set(j.id, { job_id: j.id, state: 'cancelled' })
  }
  const doneBefore = jobs.filter((j) => j.state === 'done')
  let pending = jobs.filter((j) => j.state === 'running')

  for (;;) {
    const still: Job[] = []
    for (const job of pending) {
      const result = await checkOne(job)
      if (!result) {
        reports.set(job.id, { job_id: job.id, state: 'running' })
        still.push(job)
        continue
      }
      reports.set(job.id, result.report)
      fresh.push(...result.newDrafts)
      if (result.report.state === 'running' || result.report.state === 'queued') still.push(job)
    }
    pending = still
    if (pending.length === 0 || Date.now() + 3000 > deadline) break
    await new Promise((r) => setTimeout(r, 3000))
  }

  // Jobs that had already finished before this call: report their drafts too.
  for (const j of doneBefore) {
    const drafts = await listDrafts(project.id, { jobId: j.id })
    reports.set(j.id, { job_id: j.id, state: 'done', drafts: drafts.map((d) => d.number) })
  }

  const out: Content[] = [text({
    jobs: jobs.map((j) => reports.get(j.id)),
    ...(pending.length ? { still_running: pending.length, next: 'Call check_jobs again in a little while.' } : {}),
  })]
  // Show what this call finished; with nothing new, show the already-finished ones asked about.
  const show = fresh.length
    ? fresh
    : ids ? doneBefore.flatMap((j) => reports.get(j.id)?.drafts || []) : []
  if (show.length) {
    const drafts = await listDrafts(project.id, { numbers: show.slice(0, 8) })
    for (const d of drafts) {
      if (d.type === 'video') {
        out.push(text(`Draft ${d.number} ${VIDEO_NOTE}`))
        continue
      }
      const img = await imageOf(d.url)
      if (img) out.push(text(`Draft ${d.number}`), img)
    }
    if (show.length > 8) out.push(text(`${show.length - 8} more finished; see them with list_drafts or view_draft.`))
  }
  return out
}

// ---------------------------------------------------------------------------
// cancel_jobs
// ---------------------------------------------------------------------------

async function cancelJobs(args: Args): Promise<Content[]> {
  const project = await requireProject(args)
  const ids = jobIdList(args, true)!
  const jobs = await getJobs(project.id, ids)
  if (jobs.length === 0) throw new ToolError('None of those jobs belong to this project.')
  const reports: JobReport[] = []
  for (const job of jobs) {
    if (job.state !== 'running') {
      reports.push({ job_id: job.id, state: job.state, note: 'Already finished; nothing to stop.' })
      continue
    }
    // Hold the job like a status check does, so a check can't record a result
    // for it at the same moment.
    if (!(await claimJobForCheck(job.id))) {
      reports.push({ job_id: job.id, state: 'running', note: 'It is being checked right now; try again in a moment.' })
      continue
    }
    let stopped = false
    try {
      const res = await cancelGeneration(new NextRequest('http://spite.internal/api/generate/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: job.requestId, model: job.pollModel }),
      }))
      stopped = res.ok
    } catch (err) {
      console.error('[mcp] cancel threw:', err instanceof Error ? err.message : err)
    }
    if (stopped) {
      await finishJob(job.id, 'cancelled')
      await returnToBrief(job.briefId, kindOf(job), 1)
      reports.push({ job_id: job.id, state: 'cancelled' })
    } else {
      await releaseJob(job.id)
      reports.push({ job_id: job.id, state: 'running', note: 'Could not be stopped (it has probably started rendering). It will finish as normal.' })
    }
  }
  return [text({ jobs: reports })]
}

// ---------------------------------------------------------------------------
// Entry points for the endpoint
// ---------------------------------------------------------------------------

export const SERVER_INSTRUCTIONS =
  'SPITE is a canvas app for AI filmmaking. Through these tools you work in the owner’s projects: look around, generate images and video, and put the results they choose on the board.\n' +
  'How to work:\n' +
  '1. Find the project (list_projects, get_project). Look at what is already there before proposing anything: view_board for the images and clips on the board, view_folder for reference folders.\n' +
  '2. Before generating anything, agree a brief with the user: what you will make, how many tries, which models and settings, and what each costs (list_models). Record it with agree_brief only after they say yes. Inside the brief, work freely; for anything beyond it, ask first.\n' +
  '3. generate_images or generate_videos, then check_jobs. Anything on the board or any earlier draft can be an input (a board node_id or a draft number). Results are drafts in the project’s library. Look at image drafts and say what you think. You cannot watch video: ask the user to review clips in SPITE.\n' +
  '4. The user decides what is kept. keep_drafts puts those on the board.\n' +
  'Generation costs the user real money, video most of all: quote prices per image and per clip, and never start more than was agreed. You cannot delete or change anything on the board, and cannot change settings. To bring in a file from outside, the user drops it on the board in SPITE, and it then shows up in view_board.'

export function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }))
}

export async function callTool(name: string, args: unknown): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return null
  try {
    const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Args) : {}
    return { content: await tool.run(safeArgs) }
  } catch (err) {
    if (err instanceof ToolError) return { content: [text(err.message)], isError: true }
    // Unexpected: say so without leaking internals (hostnames, SQL, paths).
    console.error(`[mcp] tool ${name} failed:`, err)
    return { content: [text('SPITE hit an unexpected problem running this. Try again; if it keeps happening, the app’s log has the details.')], isError: true }
  }
}
