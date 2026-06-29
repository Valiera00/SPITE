#!/usr/bin/env node
// ============================================================================
// migrate-mobile-to-flow.mjs — one-time: rename project origin 'mobile' → 'flow'
// ----------------------------------------------------------------------------
// The simple generation-thread mode was renamed from "mobile" to "Flow". The
// dashboard already treats anything that isn't 'canvas' as Flow, so this is
// cleanup, not a hard requirement. Reads DATABASE_URL from .env.local.
//
//   node scripts/migrate-mobile-to-flow.mjs
// ============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { neon } from '@neondatabase/serverless'

function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  const envPath = join(here, '..', '.env.local')
  let raw
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    console.error(`Could not read ${envPath}. Run from the repo with a populated .env.local.`)
    process.exit(1)
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val
  }
}
loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env.local')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'canvas'`

const updated = await sql`
  UPDATE projects SET origin = 'flow' WHERE origin = 'mobile' RETURNING id, name
`
console.log(`Migrated ${updated.length} project(s) from origin='mobile' to 'flow':`)
for (const p of updated) console.log(`  ${p.id}  ${p.name}`)
console.log('Done.')
