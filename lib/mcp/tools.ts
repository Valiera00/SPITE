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
import { getOrCreateThumbnail, renderPreview } from '../thumbnails'
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

const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`

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

/** A stored image as something Claude can look at. Null for video, or when it can't be read. */
async function imageOf(url: string, size: 'small' | 'large' = 'small'): Promise<Content | null> {
  const key = r2KeyOf(url)
  if (!key || !isThumbnailable(key)) return null
  if (size === 'large') {
    const jpeg = await renderPreview(key, 1280)
    return jpeg ? { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' } : null
  }
  const webp = await getOrCreateThumbnail(key)
  return webp ? { type: 'image', data: webp.toString('base64'), mimeType: 'image/webp' } : null
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
      'One project at a glance: its reference folders (each usable in a prompt as its @Tag), the brief currently agreed, ' +
      'and how many drafts and running jobs it has.',
    inputSchema: { type: 'object', properties: { project_id: projectIdProp }, required: ['project_id'], additionalProperties: false },
    annotations: readOnly,
    run: async (args) => {
      const project = await requireProject(args)
      const [folders, brief, drafts, jobs] = await Promise.all([
        projectFolders(project.id), activeBrief(project.id), listDrafts(project.id), getJobs(project.id),
      ])
      const count = (s: Draft['state']) => drafts.filter((d) => d.state === s).length
      return [text({
        name: project.name,
        mode: project.mode,
        folders: folders.map((f) => ({
          tag: `@${tagFromName(f.name)}`,
          name: f.name,
          kind: f.type,
          ...(f.description ? { about: f.description } : {}),
          images: f.assets.length,
        })),
        brief: brief ? briefView(brief) : 'none agreed yet',
        drafts: { not_kept: count('draft'), kept_waiting_for_board: count('kept'), on_board: count('on_board') },
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
    name: 'list_models',
    title: 'List models',
    description:
      'The image and video models this SPITE can generate with: their options, what inputs they take, and what one output costs. ' +
      'Use it to propose a brief with real prices. Video is priced per second unless it says per clip.',
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
      'Write @Tag in the prompt to use a folder’s reference images (tags from get_project). ' +
      'To make new versions of an earlier draft, or to upscale one, pass based_on_draft. ' +
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
        based_on_draft: { type: 'integer', minimum: 1, description: 'Image draft number to use as the input image.' },
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
      'Inputs: a prompt (with @Tag folder references where the model supports them), an image draft as first_frame_draft and/or end_frame_draft to animate, ' +
      'or a video draft as source_video_draft for upscalers and video-to-video models. list_models says what each model takes. ' +
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
        first_frame_draft: { type: 'integer', minimum: 1, description: 'Image draft number to start the clip from.' },
        end_frame_draft: { type: 'integer', minimum: 1, description: 'Image draft number to end the clip on.' },
        source_video_draft: { type: 'integer', minimum: 1, description: 'Video draft number, for models that take a video.' },
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

  // Drafts used as inputs. What the model can take is checked before any
  // draft is looked up, so the answer is about the model, not a draft number.
  const given = (key: string) => args[key] !== undefined && args[key] !== null
  const imageKey = kind === 'video' ? 'first_frame_draft' : 'based_on_draft'
  if ((given(imageKey) || given('end_frame_draft')) && !takesImage(model)) throw new ToolError(`${model.name} can’t take an input image.`)
  if (needsImage(model) && !given(imageKey)) throw new ToolError(`${model.name} works from an image: pass "${imageKey}".`)
  if (kind === 'video') {
    if (given('end_frame_draft') && takesVideo(model)) throw new ToolError(`${model.name} has no end frame. Leave "end_frame_draft" out.`)
    if (given('source_video_draft') && !takesVideo(model)) throw new ToolError(`${model.name} doesn’t take a video. Leave "source_video_draft" out.`)
    if (takesVideo(model) && !given('source_video_draft')) throw new ToolError(`${model.name} works from a video: pass "source_video_draft".`)
  }
  const draftInput = async (key: string, wantType: 'image' | 'video'): Promise<{ number: number; url: string } | undefined> => {
    if (args[key] === undefined || args[key] === null) return undefined
    const number = int(args, key, 1, 1_000_000)
    const [draft] = await listDrafts(project.id, { numbers: [number] })
    if (!draft) throw new ToolError(`There is no draft ${number} in this project.`)
    if (draft.type !== wantType) throw new ToolError(`Draft ${number} is ${draft.type === 'video' ? 'a video' : 'an image'}; "${key}" needs ${wantType === 'video' ? 'a video' : 'an image'} draft.`)
    return { number, url: draft.url }
  }
  const first = await draftInput(imageKey, 'image')
  const end = kind === 'video' ? await draftInput('end_frame_draft', 'image') : undefined
  const sourceVideo = kind === 'video' ? await draftInput('source_video_draft', 'video') : undefined

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
  // Image models put the input image in slot 1, ahead of folder references;
  // on video the first frame is a separate input and takes no slot.
  const compiled = compileMentionsForModel(prompt, [], folders, model, kind === 'image' && first ? 1 : 0)
  const hasRefs = compiled.refGroups.length > 0
  const notes: string[] = []
  if (tags.length && compiled.strategy === 'none') {
    notes.push(`${model.name} can’t use reference images, so the folders were sent as plain names only.`)
  } else if (tags.length && compiled.strategy === 'single') {
    notes.push(`${model.name} takes one reference image, so only the first folder’s first image was sent.`)
  }
  if (kind === 'video' && hasRefs) {
    // The same two rules the video node enforces before it lets a job go.
    if (model.referenceModel && !model.referenceTakesFrames && (first || end)) {
      throw new ToolError(
        `${model.name} can’t use a first/end frame and folder references in the same clip: they are separate modes. ` +
        'Drop the @Tags to keep the exact frame, or drop the frame to use the references.',
      )
    }
    if (model.referenceParam === 'elements' && !model.referenceModel && !first) {
      throw new ToolError(`${model.name} needs a first frame to use folder references: pass "first_frame_draft".`)
    }
  }

  if (!(await takeFromBrief(brief.id, kind, count))) {
    throw new ToolError('The agreed brief no longer has room for this (it changed a moment ago). Call get_project to see what is left.')
  }

  const body = JSON.stringify({
    modelId: model.id,
    prompt: compiled.prompt,
    referenceImageUrl: first?.url,
    endImageUrl: end?.url,
    referenceGroups: hasRefs ? compiled.refGroups : undefined,
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
        ...(first ? { fromDraft: first.number } : {}),
        ...(end ? { endDraft: end.number } : {}),
        ...(sourceVideo ? { sourceVideoDraft: sourceVideo.number } : {}),
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
  '1. Find the project (list_projects, get_project). Look inside folders you will reference (view_folder).\n' +
  '2. Before generating anything, agree a brief with the user: what you will make, how many tries, which models and settings, and what each costs (list_models). Record it with agree_brief only after they say yes. Inside the brief, work freely; for anything beyond it, ask first.\n' +
  '3. generate_images or generate_videos, then check_jobs. Results are drafts in the project’s library. Look at image drafts and say what you think. You cannot watch video: ask the user to review clips in SPITE.\n' +
  '4. The user decides what is kept. keep_drafts puts those on the board. To iterate, generate again from a draft (based_on_draft, first_frame_draft).\n' +
  'Generation costs the user real money, video most of all: quote prices per image and per clip, and never start more than was agreed. You cannot delete anything or change settings here.'

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
