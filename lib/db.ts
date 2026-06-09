import { neon } from '@neondatabase/serverless'

// Lazy initialization - only create connection when needed
// This ensures DATABASE_URL is available at runtime
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

// Shape of the sql tagged-template returned by `neon()`. Exported for
// helper modules that take a sql instance as a parameter (e.g. the
// ensureSchema helpers in lib/sessions.ts, fal-voices.ts).
export type Sql = ReturnType<typeof getDb>
