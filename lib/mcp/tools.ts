// The tools SPITE's MCP endpoint offers. Each one goes through the same code
// the app's own buttons use: generation is submitted and polled through the
// /api/generate routes (so the spend gate, provider routing and library
// recording all apply unchanged), and folder references are compiled by the
// same function the image node uses.
//
// What is deliberately absent: anything that deletes, anything that changes
// settings, anything that reads a key.

import { NextRequest } from 'next/server'
import { POST as submitGeneration } from '@/app/api/generate/submit/route'
import { GET as generationStatus } from '@/app/api/generate/status/route'
import { GET as foldersGet } from '@/app/api/folders/route'
import { getDb } from '../db'
import { getImageModels, getModelById, type ModelConfig } from '../fal-models'
import { estimateGenerationCost } from '../fal-cost'
import { compileMentionsForModel, pickRefStrategy, type FolderType } from '../mention-prompt'
import { isThumbnailable } from '../r2-upload'
import { getOrCreateThumbnail, renderPreview } from '../thumbnails'
import { getMcpHourlyLimitUsd } from './access'
import {
  activeBrief, addDraft, claimJobForCheck, createJob, finishJob, getJobs, keepDrafts, listDrafts,
  mcpSpendLastHourUsd, releaseJob, returnToBrief, startBrief, takeFromBrief,
  type Brief, type Draft, type Job,
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
    // Image models take images; a folder's video or audio can't ride along.
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

function generatableModels(): ModelConfig[] {
  // Prompt-driven image models. Upscalers take no prompt and are left out.
  return getImageModels().filter((m) => m.inputTypes.includes('text') && !m.optionalPrompt)
}

function pricePerImage(model: ModelConfig, resolution?: string, quality?: string): number | null {
  const e = estimateGenerationCost(model, { count: 1, resolution, quality })
  return e.isKnown ? e.perUnit : null
}

const briefView = (b: Brief) => ({
  summary: b.summary,
  images_left: Math.max(0, b.maxImages - b.usedImages),
  of: b.maxImages,
  models: b.models ?? 'any',
  max_price_per_image: b.maxPricePerImage === null ? 'none set' : usd(b.maxPricePerImage),
  valid_until: b.expiresAt,
})

const draftView = (d: Draft) => ({
  draft: d.number,
  state: d.state,
  model: d.modelId,
  prompt: d.prompt,
  made: d.createdAt,
})

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
    title: 'List image models',
    description:
      'The image models this SPITE can generate with: their options, whether they can use reference images, and the price of ONE image at each setting. ' +
      'Use it to propose a brief with real prices.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
    run: async () => {
      const refs: Record<string, string> = {
        'citation-flat': 'several', 'citation-elements': 'several', multi: 'several', single: 'one', none: 'none',
      }
      return [text(generatableModels().map((m) => {
        const tiers = m.resolutions?.length ? m.resolutions : [undefined]
        const price = (q?: string) => Object.fromEntries(tiers.map((r) => {
          const p = pricePerImage(m, r, q)
          return [r ?? 'any size', p === null ? 'unknown' : usd(p)]
        }))
        return {
          model: m.id,
          name: m.name,
          about: m.description,
          aspect_ratios: m.aspectRatios.length ? m.aspectRatios : 'fixed',
          ...(m.resolutions?.length ? { resolutions: m.resolutions, default_resolution: m.defaultResolution } : {}),
          ...(m.qualities?.length ? { qualities: m.qualities, default_quality: m.defaultQuality } : {}),
          reference_images: refs[pickRefStrategy(m)],
          takes_input_image: m.inputTypes.includes('image'),
          price_per_image: m.qualities?.length
            ? Object.fromEntries(m.qualities.map((q) => [q, price(q)]))
            : price(),
        }
      }))]
    },
  },

  {
    name: 'agree_brief',
    title: 'Record the agreed brief',
    description:
      'Records what the user has agreed you may do in a project: how many images, optionally with which models and up to what price per image. ' +
      'SPITE enforces it; generate_images refuses anything outside it. ' +
      'Call this ONLY after the user has explicitly approved this exact brief in the conversation. Propose it first, with per-image prices from list_models, and wait for a yes. ' +
      'To go beyond a brief (more images, a pricier model or setting), ask the user and record a new one; a new brief replaces the old. A brief lasts 12 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        summary: { type: 'string', description: 'The brief in the words the user agreed to, e.g. "Up to 8 tries at the rooftop shot, Nano Banana Pro, 2K".' },
        max_images: { type: 'integer', minimum: 1, maximum: 200, description: 'Most images you may generate under this brief.' },
        models: { type: 'array', items: { type: 'string' }, description: 'Model ids allowed. Omit to allow any model.' },
        max_price_per_image: { type: 'number', minimum: 0, description: 'Highest price in USD for one image. Omit for no cap beyond SPITE’s own limits.' },
      },
      required: ['project_id', 'summary', 'max_images'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args) => {
      const project = await requireProject(args)
      const summary = str(args, 'summary')!.slice(0, 600)
      const maxImages = int(args, 'max_images', 1, 200)
      let models: string[] | null = null
      if (args.models !== undefined && args.models !== null) {
        if (!Array.isArray(args.models) || args.models.some((m) => typeof m !== 'string')) throw new ToolError('"models" must be a list of model ids.')
        const known = new Set(generatableModels().map((m) => m.id))
        const unknown = (args.models as string[]).filter((m) => !known.has(m))
        if (unknown.length) throw new ToolError(`Unknown model id: ${unknown.join(', ')}. Call list_models.`)
        models = (args.models as string[]).length ? Array.from(new Set(args.models as string[])) : null
      }
      let maxPrice: number | null = null
      if (args.max_price_per_image !== undefined && args.max_price_per_image !== null) {
        maxPrice = Number(args.max_price_per_image)
        if (!Number.isFinite(maxPrice) || maxPrice < 0) throw new ToolError('"max_price_per_image" must be a price in USD.')
      }
      const brief = await startBrief({ projectId: project.id, summary, maxImages, models, maxPricePerImage: maxPrice })
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
      'To make new versions of an earlier draft, pass based_on_draft and describe the change. ' +
      'Returns job ids at once; results come from check_jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectIdProp,
        prompt: { type: 'string', description: 'What to make. May include @Tag folder references.' },
        model: { type: 'string', description: 'Model id from list_models.' },
        count: { type: 'integer', minimum: 1, maximum: 8, description: 'How many separate tries of this prompt. Default 1.' },
        aspect_ratio: { type: 'string', description: 'One of the model’s aspect ratios. Default: the model’s own.' },
        resolution: { type: 'string', description: 'One of the model’s resolutions. Default: the model’s own.' },
        quality: { type: 'string', description: 'One of the model’s qualities, for models that have them.' },
        based_on_draft: { type: 'integer', minimum: 1, description: 'Draft number to use as the input image (iterate on it).' },
      },
      required: ['project_id', 'prompt', 'model'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: generateImages,
  },

  {
    name: 'check_jobs',
    title: 'Check jobs',
    description:
      'Progress of generation jobs. Finished images are shown and get a draft number. ' +
      'With no job_ids it covers everything still running in the project plus what finished in the last 15 minutes. ' +
      'Images usually take 10–60 seconds; wait_seconds lets this call wait for results instead of you calling repeatedly.',
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
    name: 'list_drafts',
    title: 'List drafts',
    description:
      'The images you have made in a project, by draft number. state "draft" = in the library only, "kept" = waiting to appear on the board, "on_board" = placed. ' +
      'Set show_images to look at them again.',
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
        for (const d of drafts.slice(-12)) {
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
    description: 'Shows one draft, small or large. Use large to judge detail before recommending what to keep.',
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
// generate_images
// ---------------------------------------------------------------------------

async function generateImages(args: Args): Promise<Content[]> {
  const project = await requireProject(args)
  const prompt = str(args, 'prompt')!
  if (prompt.length > 8000) throw new ToolError('The prompt is too long (8000 characters at most).')
  const modelId = str(args, 'model')!
  const count = int(args, 'count', 1, 8, 1)

  const model = generatableModels().find((m) => m.id === modelId)
  if (!model) throw new ToolError(`Unknown image model "${modelId}". Call list_models.`)

  const pick = (key: string, options: string[] | undefined, fallback: string | undefined, label: string) => {
    const v = str(args, key, false)
    if (!v) return fallback || undefined
    if (!options?.length) throw new ToolError(`${model.name} has no ${label} setting. Leave "${key}" out.`)
    if (!options.includes(v)) throw new ToolError(`${model.name} doesn’t offer ${label} "${v}". Options: ${options.join(', ')}.`)
    return v
  }
  const aspectRatio = pick('aspect_ratio', model.aspectRatios, model.defaultAspectRatio, 'aspect ratio')
  const resolution = pick('resolution', model.resolutions, model.defaultResolution, 'resolution')
  const quality = pick('quality', model.qualities, model.defaultQuality, 'quality')

  // The brief is the user's standing yes. No brief, no generation.
  const brief = await activeBrief(project.id)
  if (!brief) {
    throw new ToolError(
      'No brief is agreed for this project (or the last one ran out after 12 hours). ' +
      'Propose one to the user with per-image prices, and once they approve, call agree_brief.',
    )
  }
  if (brief.models && !brief.models.includes(model.id)) {
    throw new ToolError(`The agreed brief allows only: ${brief.models.join(', ')}. Ask the user before using ${model.name}, then record a new brief.`)
  }
  const price = pricePerImage(model, resolution, quality)
  if (price === null) throw new ToolError(`SPITE has no price on record for ${model.name}, so it won’t run it.`)
  if (brief.maxPricePerImage !== null && price > brief.maxPricePerImage + 1e-9) {
    throw new ToolError(
      `One image at these settings is about ${usd(price)}, over the ${usd(brief.maxPricePerImage)} per image in the agreed brief. ` +
      'Pick a cheaper setting, or ask the user and record a new brief.',
    )
  }
  const left = brief.maxImages - brief.usedImages
  if (count > left) {
    throw new ToolError(
      left > 0
        ? `The agreed brief has ${left} image${left === 1 ? '' : 's'} left, and this asks for ${count}. Ask for fewer, or ask the user for more and record a new brief.`
        : 'The agreed brief is used up. Ask the user whether to continue, then record a new brief.',
    )
  }
  // The owner's own ceiling for this connection, from Settings. Stated as a
  // limit, never as a running total.
  const hourly = await getMcpHourlyLimitUsd()
  if ((await mcpSpendLastHourUsd()) + price * count > hourly + 1e-9) {
    throw new ToolError(
      'This would go over the hourly limit set for Claude in SPITE’s Settings. ' +
      'Ask for fewer images or a cheaper setting, wait a while, or the user can raise it in Settings → Claude connection.',
    )
  }

  // Input image for iterating on a draft.
  let basedOnUrl: string | undefined
  let basedOn: number | undefined
  if (args.based_on_draft !== undefined && args.based_on_draft !== null) {
    basedOn = int(args, 'based_on_draft', 1, 1_000_000)
    if (!model.inputTypes.includes('image')) throw new ToolError(`${model.name} can’t take an input image. Choose a model with takes_input_image.`)
    const [draft] = await listDrafts(project.id, { numbers: [basedOn] })
    if (!draft) throw new ToolError(`There is no draft ${basedOn} in this project.`)
    if (draft.type !== 'image') throw new ToolError(`Draft ${basedOn} isn’t an image.`)
    basedOnUrl = draft.url
  }

  // @Tag references, compiled exactly as the image node does it.
  const folders = await projectFolders(project.id)
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
  const compiled = compileMentionsForModel(prompt, [], folders, model, basedOnUrl ? 1 : 0)
  const notes: string[] = []
  if (tags.length && compiled.strategy === 'none') {
    notes.push(`${model.name} can’t use reference images, so the folders were sent as plain names only.`)
  } else if (tags.length && compiled.strategy === 'single') {
    notes.push(`${model.name} takes one reference image, so only the first folder’s first image was sent.`)
  }

  if (!(await takeFromBrief(brief.id, count))) {
    throw new ToolError('The agreed brief no longer has room for this (it changed a moment ago). Call get_project to see what is left.')
  }

  const settings = { aspectRatio, resolution, quality, numImages: 1 }
  const body = JSON.stringify({
    modelId: model.id,
    prompt: compiled.prompt,
    referenceImageUrl: basedOnUrl,
    referenceGroups: compiled.refGroups.length ? compiled.refGroups : undefined,
    settings,
  })

  // One job per image, never overlapping — the same pacing the image node uses.
  const jobs: string[] = []
  let failure: string | null = null
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
      await returnToBrief(brief.id, count - i) // this one and the rest never started
      break
    }
    jobs.push(await createJob({
      projectId: project.id,
      briefId: brief.id,
      requestId: String(data.request_id),
      pollModel: String(data.model),
      modelId: model.id,
      prompt,
      settings: { aspectRatio, resolution, quality, ...(basedOn ? { basedOnDraft: basedOn } : {}) },
      estimatedUsd: typeof data.estimatedUsd === 'number' ? data.estimatedUsd : price,
    }))
  }

  if (jobs.length === 0) throw new ToolError(`Nothing was started. ${failure}`)
  const after = await activeBrief(project.id)
  return [text({
    started: jobs.length,
    job_ids: jobs,
    model: model.name,
    price_per_image: usd(price),
    brief_images_left: after ? Math.max(0, after.maxImages - after.usedImages) : 0,
    ...(failure ? { stopped_early: `Only ${jobs.length} of ${count} started. ${failure}` } : {}),
    ...(notes.length ? { notes } : {}),
    next: 'Call check_jobs for the results.',
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
    const q = new URLSearchParams({ request_id: job.requestId, model: job.pollModel, projectId: job.projectId, prompt: job.prompt })
    const res = await generationStatus(new NextRequest(`http://spite.internal/api/generate/status?${q.toString()}`))
    const data = ((await res.json().catch(() => ({}))) || {}) as {
      status?: string; error?: string; output?: { images?: string[]; url?: string }
    }
    if (data.status === 'FAILED') {
      const error = (typeof data.error === 'string' ? data.error : 'Generation failed').slice(0, 400)
      await finishJob(job.id, 'failed', error)
      await returnToBrief(job.briefId, 1) // a failed try doesn't use up the brief
      return { report: { job_id: job.id, state: 'failed', error }, newDrafts: [] }
    }
    if (data.status === 'COMPLETED') {
      const urls = data.output?.images?.length ? data.output.images : data.output?.url ? [data.output.url] : []
      const numbers: number[] = []
      for (const url of urls) {
        // The status route has just recorded each image in the library; find
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
  let ids: string[] | undefined
  if (args.job_ids !== undefined && args.job_ids !== null) {
    if (!Array.isArray(args.job_ids) || args.job_ids.some((j) => typeof j !== 'string') || args.job_ids.length > 40) {
      throw new ToolError('"job_ids" must be a list of up to 40 job ids.')
    }
    ids = args.job_ids as string[]
  }
  const wait = int(args, 'wait_seconds', 0, 40, 20)
  const deadline = Date.now() + wait * 1000

  const jobs = await getJobs(project.id, ids)
  if (jobs.length === 0) return [text(ids ? 'None of those jobs belong to this project.' : 'No jobs are running, and none finished in the last 15 minutes.')]

  const reports = new Map<string, JobReport>()
  const fresh: number[] = []
  for (const j of jobs) {
    if (j.state === 'failed') reports.set(j.id, { job_id: j.id, state: 'failed', error: j.error || 'Generation failed' })
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
      const img = await imageOf(d.url)
      if (img) out.push(text(`Draft ${d.number}`), img)
    }
    if (show.length > 8) out.push(text(`${show.length - 8} more finished; see them with list_drafts or view_draft.`))
  }
  return out
}

// ---------------------------------------------------------------------------
// Entry points for the endpoint
// ---------------------------------------------------------------------------

export const SERVER_INSTRUCTIONS =
  'SPITE is a canvas app for AI filmmaking. Through these tools you work in the owner’s projects: look around, generate images, and put the ones they choose on the board.\n' +
  'How to work:\n' +
  '1. Find the project (list_projects, get_project). Look inside folders you will reference (view_folder).\n' +
  '2. Before generating anything, agree a brief with the user: what you will make, how many tries, which model and settings, and the price per image (list_models). Record it with agree_brief only after they say yes. Inside the brief, work freely; for anything beyond it, ask first.\n' +
  '3. generate_images, then check_jobs. Results are drafts in the project’s library. Look at them and say what you think.\n' +
  '4. The user decides what is kept. keep_drafts puts those on the board. To iterate, generate again with based_on_draft.\n' +
  'Generation costs the user real money: quote prices per image, and never start more than was agreed. You cannot delete anything or change settings here.'

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
