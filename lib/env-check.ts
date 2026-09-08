// Centralised "is this install configured?" check. Used by the
// middleware to short-circuit every request into the setup page when
// the required environment variables haven't been filled in yet. Keeps
// new self-hosters from staring at a blank login screen wondering why
// nothing works.

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'APP_PASSWORD',
  'FAL_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number]

export interface EnvCheckResult {
  ok: boolean
  missing: RequiredEnvVar[]
}

export function checkRequiredEnv(): EnvCheckResult {
  // R2_ACCOUNT_ID exists only to build Cloudflare's endpoint URL. If a
  // custom S3_ENDPOINT is supplied it replaces that entirely, so stop
  // demanding it — otherwise anyone using MinIO/B2 would be stuck on the
  // setup page forever with no way to satisfy it.
  const customEndpoint = !!process.env.S3_ENDPOINT?.trim()
  const missing = REQUIRED_ENV_VARS.filter((key) => {
    if (key === 'R2_ACCOUNT_ID' && customEndpoint) return false
    return !process.env[key]?.trim()
  })
  return { ok: missing.length === 0, missing }
}

/** Which object store this install is talking to, for display on /setup. */
export function storageTarget(): { label: string; custom: boolean } {
  const custom = process.env.S3_ENDPOINT?.trim()
  return custom
    ? { label: custom.replace(/^https?:\/\//, ''), custom: true }
    : { label: 'Cloudflare R2', custom: false }
}

// Human-friendly explanation for each variable. Surfaced on the setup
// page so a non-technical user knows exactly where to obtain each
// value. Keep these short — full instructions live in the README.
export const ENV_VAR_HINTS: Record<RequiredEnvVar, string> = {
  DATABASE_URL: 'Neon Postgres connection string — neon.tech → your project → Connection string',
  APP_PASSWORD: 'The password you\'ll type at the SPITE login screen. Choose anything strong.',
  FAL_KEY: 'fal.ai API key — fal.ai → Dashboard → Keys',
  R2_ACCOUNT_ID: 'Cloudflare R2 account ID — visible in the right sidebar of any R2 page',
  R2_ACCESS_KEY_ID: 'Cloudflare R2 access key — Cloudflare dashboard → R2 → Manage API tokens',
  R2_SECRET_ACCESS_KEY: 'Cloudflare R2 secret key — issued alongside the access key above',
  R2_BUCKET_NAME: 'The name of the R2 bucket you created for SPITE',
}

// Presentational grouping for the setup page. Purely additive — the boot
// check above is unchanged. Grouping by service means a new self-hoster
// works through four short errands ("get a database", "make a bucket")
// instead of staring at seven unrelated variable names.
export interface EnvGroup {
  title: string
  /** what this group is for, in one plain-English line */
  blurb: string
  vars: RequiredEnvVar[]
  /** where to go to obtain these values */
  linkLabel: string
  linkUrl: string
}

export const ENV_GROUPS: EnvGroup[] = [
  {
    title: 'Database',
    blurb: 'Stores your projects, canvases and asset records.',
    vars: ['DATABASE_URL'],
    // the console, not the marketing site — this is where the
    // connection string actually lives
    linkLabel: 'Neon console',
    linkUrl: 'https://console.neon.tech/',
  },
  {
    title: 'Storage',
    blurb: 'Holds the images and video you generate. Yours, not ours.',
    vars: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'],
    // ?to= survives the login redirect, dropping you straight on the R2
    // API-tokens screen instead of the dashboard home
    linkLabel: 'Cloudflare R2 tokens',
    linkUrl: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens',
  },
  {
    title: 'Generation',
    blurb: 'The models. You pay fal directly for what you generate.',
    vars: ['FAL_KEY'],
    linkLabel: 'fal.ai keys',
    linkUrl: 'https://fal.ai/dashboard/keys',
  },
  {
    title: 'Your login',
    blurb: 'The password that keeps the internet out of your canvas.',
    vars: ['APP_PASSWORD'],
    linkLabel: 'pick anything strong',
    linkUrl: '',
  },
]
