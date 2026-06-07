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
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key]?.trim(),
  )
  return { ok: missing.length === 0, missing }
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
