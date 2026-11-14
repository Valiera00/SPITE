// What the MCP endpoint remembers between tool calls: the brief the owner
// agreed to, the jobs Claude started, and the drafts those jobs produced.
//
// A draft is an ordinary library asset (a generation_history row) that Claude
// made. It gets a short per-project number so it can be talked about ("keep 2
// and 5"). Keeping a draft queues it for the board: the open canvas is the
// only writer of its own nodes (its save replaces them all), so the server
// never inserts a node itself — the canvas picks kept drafts up and places
// them (see app/api/projects/[projectId]/board-inbox).

import { randomBytes } from 'node:crypto'
import { getDb, type Sql } from '../db'

let ready = false
async function ensure(sql: Sql) {
  if (ready) return
  await sql`CREATE TABLE IF NOT EXISTS mcp_briefs (
    id                   text PRIMARY KEY,
    project_id           text NOT NULL,
    summary              text NOT NULL,
    max_images           integer NOT NULL,
    used_images          integer NOT NULL DEFAULT 0,
    models               jsonb,
    max_price_per_image  numeric(10,4),
    created_at           timestamptz NOT NULL DEFAULT now(),
    expires_at           timestamptz NOT NULL,
    replaced_at          timestamptz
  )`
  await sql`CREATE INDEX IF NOT EXISTS idx_mcp_briefs_project ON mcp_briefs (project_id, created_at DESC)`
  // Video allowance, added after the first (images-only) version.
  await sql`ALTER TABLE mcp_briefs ADD COLUMN IF NOT EXISTS max_videos integer NOT NULL DEFAULT 0`
  await sql`ALTER TABLE mcp_briefs ADD COLUMN IF NOT EXISTS used_videos integer NOT NULL DEFAULT 0`
  await sql`ALTER TABLE mcp_briefs ADD COLUMN IF NOT EXISTS max_price_per_video numeric(10,4)`
  await sql`CREATE TABLE IF NOT EXISTS mcp_jobs (
    id             text PRIMARY KEY,
    project_id     text NOT NULL,
    brief_id       text,
    request_id     text NOT NULL,
    poll_model     text NOT NULL,
    model_id       text NOT NULL,
    prompt         text NOT NULL,
    settings       jsonb,
    estimated_usd  numeric(10,4) NOT NULL DEFAULT 0,
    state          text NOT NULL DEFAULT 'running',
    error          text,
    checking_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz
  )`
  await sql`CREATE INDEX IF NOT EXISTS idx_mcp_jobs_project ON mcp_jobs (project_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_mcp_jobs_time ON mcp_jobs (created_at)`
  await sql`CREATE TABLE IF NOT EXISTS mcp_drafts (
    project_id  text NOT NULL,
    number      integer NOT NULL,
    asset_id    text NOT NULL,
    job_id      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    kept_at     timestamptz,
    placed_at   timestamptz,
    PRIMARY KEY (project_id, number)
  )`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_drafts_asset ON mcp_drafts (asset_id)`
  ready = true
}

function newId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export interface Brief {
  id: string
  projectId: string
  summary: string
  maxImages: number
  usedImages: number
  models: string[] | null
  maxPricePerImage: number | null
  maxVideos: number
  usedVideos: number
  maxPricePerVideo: number | null
  expiresAt: string
}

export type Kind = 'image' | 'video'

const BRIEF_HOURS = 12

function toBrief(r: Record<string, unknown>): Brief {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    summary: String(r.summary),
    maxImages: Number(r.max_images),
    usedImages: Number(r.used_images),
    models: Array.isArray(r.models) ? (r.models as string[]) : null,
    maxPricePerImage: r.max_price_per_image === null || r.max_price_per_image === undefined ? null : Number(r.max_price_per_image),
    maxVideos: Number(r.max_videos) || 0,
    usedVideos: Number(r.used_videos) || 0,
    maxPricePerVideo: r.max_price_per_video === null || r.max_price_per_video === undefined ? null : Number(r.max_price_per_video),
    expiresAt: new Date(r.expires_at as string).toISOString(),
  }
}

/** Record the agreed brief for a project. Any earlier brief for it stops applying. */
export async function startBrief(input: {
  projectId: string
  summary: string
  maxImages: number
  models: string[] | null
  maxPricePerImage: number | null
  maxVideos: number
  maxPricePerVideo: number | null
}): Promise<Brief> {
  const sql = getDb()
  await ensure(sql)
  const id = newId('brief')
  const expires = new Date(Date.now() + BRIEF_HOURS * 3600_000).toISOString()
  const results = await sql.transaction([
    sql`UPDATE mcp_briefs SET replaced_at = now() WHERE project_id = ${input.projectId} AND replaced_at IS NULL`,
    sql`INSERT INTO mcp_briefs (id, project_id, summary, max_images, models, max_price_per_image, max_videos, max_price_per_video, expires_at)
        VALUES (${id}, ${input.projectId}, ${input.summary}, ${input.maxImages},
                ${input.models ? JSON.stringify(input.models) : null}::jsonb, ${input.maxPricePerImage},
                ${input.maxVideos}, ${input.maxPricePerVideo}, ${expires})
        RETURNING *`,
  ])
  return toBrief((results[1] as Record<string, unknown>[])[0])
}

/** The brief currently in force for a project, if any. */
export async function activeBrief(projectId: string): Promise<Brief | null> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`
    SELECT * FROM mcp_briefs
    WHERE project_id = ${projectId} AND replaced_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1
  `
  return rows.length ? toBrief(rows[0]) : null
}

/** Take `n` images or videos out of a brief's allowance. False when that would exceed it: nothing is taken. */
export async function takeFromBrief(briefId: string, kind: Kind, n: number): Promise<boolean> {
  const sql = getDb()
  await ensure(sql)
  const rows = kind === 'video'
    ? await sql`
        UPDATE mcp_briefs SET used_videos = used_videos + ${n}
        WHERE id = ${briefId} AND replaced_at IS NULL AND expires_at > now() AND used_videos + ${n} <= max_videos
        RETURNING id
      `
    : await sql`
        UPDATE mcp_briefs SET used_images = used_images + ${n}
        WHERE id = ${briefId} AND replaced_at IS NULL AND expires_at > now() AND used_images + ${n} <= max_images
        RETURNING id
      `
  return rows.length > 0
}

/** Hand allowance back to a brief (a job that never started, failed, or was cancelled). */
export async function returnToBrief(briefId: string | null | undefined, kind: Kind, n: number): Promise<void> {
  if (!briefId || n <= 0) return
  const sql = getDb()
  await ensure(sql)
  if (kind === 'video') await sql`UPDATE mcp_briefs SET used_videos = GREATEST(0, used_videos - ${n}) WHERE id = ${briefId}`
  else await sql`UPDATE mcp_briefs SET used_images = GREATEST(0, used_images - ${n}) WHERE id = ${briefId}`
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface Job {
  id: string
  projectId: string
  briefId: string | null
  requestId: string
  pollModel: string
  modelId: string
  prompt: string
  settings: Record<string, unknown>
  state: 'running' | 'done' | 'failed' | 'cancelled'
  error: string | null
  createdAt: string
}

function toJob(r: Record<string, unknown>): Job {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    briefId: r.brief_id ? String(r.brief_id) : null,
    requestId: String(r.request_id),
    pollModel: String(r.poll_model),
    modelId: String(r.model_id),
    prompt: String(r.prompt),
    settings: (r.settings as Record<string, unknown>) || {},
    state: r.state as Job['state'],
    error: r.error ? String(r.error) : null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }
}

export async function createJob(input: {
  projectId: string
  briefId: string | null
  requestId: string
  pollModel: string
  modelId: string
  prompt: string
  settings: Record<string, unknown>
  estimatedUsd: number
}): Promise<string> {
  const sql = getDb()
  await ensure(sql)
  const id = newId('job')
  await sql`
    INSERT INTO mcp_jobs (id, project_id, brief_id, request_id, poll_model, model_id, prompt, settings, estimated_usd)
    VALUES (${id}, ${input.projectId}, ${input.briefId}, ${input.requestId}, ${input.pollModel}, ${input.modelId},
            ${input.prompt}, ${JSON.stringify(input.settings)}::jsonb, ${input.estimatedUsd})
  `
  return id
}

/** Estimated cost of the jobs Claude started in the last hour, failed ones excluded. */
export async function mcpSpendLastHourUsd(): Promise<number> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`
    SELECT COALESCE(SUM(estimated_usd), 0)::float8 AS total FROM mcp_jobs
    WHERE created_at > now() - interval '1 hour' AND state <> 'failed'
  `
  return Number(rows[0]?.total) || 0
}

export async function getJobs(projectId: string, ids?: string[]): Promise<Job[]> {
  const sql = getDb()
  await ensure(sql)
  const rows = ids && ids.length
    ? await sql`SELECT * FROM mcp_jobs WHERE project_id = ${projectId} AND id = ANY(${ids}::text[]) ORDER BY created_at`
    // Default view: everything still running, plus what finished recently.
    : await sql`
        SELECT * FROM mcp_jobs
        WHERE project_id = ${projectId}
          AND (state = 'running' OR finished_at > now() - interval '15 minutes')
        ORDER BY created_at
      `
  return rows.map(toJob)
}

/**
 * Reserve a running job for one status check. The check re-hosts and records
 * the result when the job has finished, and doing that twice would store every
 * image twice — so only one check may be in flight per job. Returns false when
 * another check holds it (or the job is no longer running).
 */
export async function claimJobForCheck(jobId: string): Promise<boolean> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`
    UPDATE mcp_jobs SET checking_at = now()
    WHERE id = ${jobId} AND state = 'running'
      AND (checking_at IS NULL OR checking_at < now() - interval '90 seconds')
    RETURNING id
  `
  return rows.length > 0
}

export async function releaseJob(jobId: string): Promise<void> {
  const sql = getDb()
  await ensure(sql)
  await sql`UPDATE mcp_jobs SET checking_at = NULL WHERE id = ${jobId} AND state = 'running'`
}

export async function finishJob(jobId: string, state: 'done' | 'failed' | 'cancelled', error?: string): Promise<void> {
  const sql = getDb()
  await ensure(sql)
  await sql`
    UPDATE mcp_jobs SET state = ${state}, error = ${error ?? null}, checking_at = NULL, finished_at = now()
    WHERE id = ${jobId}
  `
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface Draft {
  number: number
  assetId: string
  jobId: string | null
  url: string
  type: string
  prompt: string
  modelId: string | null
  settings: Record<string, unknown>
  createdAt: string
  /** 'draft' = in the library only; 'kept' = queued for the board; 'on_board' = placed. */
  state: 'draft' | 'kept' | 'on_board'
}

function toDraft(r: Record<string, unknown>): Draft {
  return {
    number: Number(r.number),
    assetId: String(r.asset_id),
    jobId: r.job_id ? String(r.job_id) : null,
    url: String(r.r2_url),
    type: String(r.type),
    // The job keeps the prompt as it was written (with @Folder tags); the
    // library row has the compiled one. Prefer what was written.
    prompt: String(r.job_prompt ?? r.prompt ?? ''),
    modelId: r.model_id ? String(r.model_id) : null,
    settings: (r.settings as Record<string, unknown>) || {},
    createdAt: new Date(r.created_at as string).toISOString(),
    state: r.placed_at || r.used_in_canvas ? 'on_board' : r.kept_at ? 'kept' : 'draft',
  }
}

/** Give a finished image its draft number. Returns the existing number if it already has one. */
export async function addDraft(projectId: string, assetId: string, jobId: string | null): Promise<number> {
  const sql = getDb()
  await ensure(sql)
  // Two jobs finishing together can pick the same next number; the primary
  // key refuses the second, which simply tries again.
  for (let attempt = 0; attempt < 6; attempt++) {
    const existing = await sql`SELECT number FROM mcp_drafts WHERE asset_id = ${assetId} LIMIT 1`
    if (existing.length) return Number(existing[0].number)
    try {
      const rows = await sql`
        INSERT INTO mcp_drafts (project_id, number, asset_id, job_id)
        SELECT ${projectId}, COALESCE(MAX(number), 0) + 1, ${assetId}, ${jobId}
        FROM mcp_drafts WHERE project_id = ${projectId}
        RETURNING number
      `
      return Number(rows[0].number)
    } catch (err) {
      if (attempt === 5) throw err
    }
  }
  throw new Error('could not number the draft')
}

// Drafts whose asset is gone (cleared from the library) drop out of every
// listing: the join to generation_history is what makes a draft real.
export async function listDrafts(projectId: string, opts: { numbers?: number[]; jobId?: string } = {}): Promise<Draft[]> {
  const sql = getDb()
  await ensure(sql)
  const numbers = opts.numbers && opts.numbers.length ? opts.numbers : null
  const rows = await sql`
    SELECT d.number, d.asset_id, d.job_id, d.created_at, d.kept_at, d.placed_at,
           g.r2_url, g.type, g.prompt, g.used_in_canvas,
           j.prompt AS job_prompt, j.model_id, j.settings
    FROM mcp_drafts d
    JOIN generation_history g ON g.id = d.asset_id
    LEFT JOIN mcp_jobs j ON j.id = d.job_id
    WHERE d.project_id = ${projectId}
      AND (${numbers}::int[] IS NULL OR d.number = ANY(${numbers}::int[]))
      AND (${opts.jobId ?? null}::text IS NULL OR d.job_id = ${opts.jobId ?? null})
    ORDER BY d.number
  `
  return rows.map(toDraft)
}

/**
 * Mark drafts as kept: they join the queue for the board, and the library
 * stops counting down on them — a shot the owner asked to keep must not expire
 * while it waits for the canvas to be opened.
 */
export async function keepDrafts(projectId: string, numbers: number[]): Promise<void> {
  if (numbers.length === 0) return
  const sql = getDb()
  await ensure(sql)
  await sql.transaction([
    sql`UPDATE mcp_drafts SET kept_at = COALESCE(kept_at, now())
        WHERE project_id = ${projectId} AND number = ANY(${numbers}::int[])`,
    sql`UPDATE generation_history SET expires_at = NULL
        WHERE project_id = ${projectId}
          AND id IN (SELECT asset_id FROM mcp_drafts WHERE project_id = ${projectId} AND number = ANY(${numbers}::int[]))`,
  ])
}

/** Kept drafts the canvas has not placed yet. */
export async function boardInbox(projectId: string): Promise<Draft[]> {
  const sql = getDb()
  await ensure(sql)
  const rows = await sql`
    SELECT d.number, d.asset_id, d.job_id, d.created_at, d.kept_at, d.placed_at,
           g.r2_url, g.type, g.prompt, g.used_in_canvas,
           j.prompt AS job_prompt, j.model_id, j.settings
    FROM mcp_drafts d
    JOIN generation_history g ON g.id = d.asset_id
    LEFT JOIN mcp_jobs j ON j.id = d.job_id
    WHERE d.project_id = ${projectId} AND d.kept_at IS NOT NULL AND d.placed_at IS NULL
    ORDER BY d.number
  `
  return rows.map(toDraft)
}

/** The canvas confirms it placed these drafts. */
export async function markPlaced(projectId: string, numbers: number[]): Promise<void> {
  if (numbers.length === 0) return
  const sql = getDb()
  await ensure(sql)
  await sql`UPDATE mcp_drafts SET placed_at = now()
            WHERE project_id = ${projectId} AND number = ANY(${numbers}::int[]) AND placed_at IS NULL`
}
