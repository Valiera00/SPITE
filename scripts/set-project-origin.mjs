#!/usr/bin/env node
// ============================================================================
// set-project-origin.mjs — reclassify a project as 'mobile' (or 'canvas')
// ----------------------------------------------------------------------------
// Projects created before the `origin` column existed all default to 'canvas'.
// This flips a specific project (matched by exact name) so it lands in the
// desktop "Mobile projects" section and opens the thread UI.
//
//   node scripts/set-project-origin.mjs "Mobile test"            # -> mobile
//   node scripts/set-project-origin.mjs "Mobile test" canvas     # -> canvas
//
// Reads DATABASE_URL from .env.local (same as the other scripts). It prints the
// matching rows and updates only exact name matches.
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

const name = process.argv[2]
const origin = (process.argv[3] || 'mobile').toLowerCase()
if (!name) {
  console.error('Usage: node scripts/set-project-origin.mjs "<exact project name>" [mobile|canvas]')
  process.exit(1)
}
if (origin !== 'mobile' && origin !== 'canvas') {
  console.error(`origin must be 'mobile' or 'canvas', got '${origin}'`)
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

// Make sure the column exists (no-op if it already does).
await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'canvas'`

const matches = await sql`
  SELECT id, name, COALESCE(origin, 'canvas') AS origin, updatedat
  FROM projects WHERE name = ${name}
`
if (matches.length === 0) {
  console.error(`No project named exactly "${name}". Check the name (it is case-sensitive).`)
  process.exit(1)
}

console.log(`Found ${matches.length} project(s) named "${name}":`)
for (const m of matches) console.log(`  ${m.id}  origin=${m.origin}  updated=${m.updatedat}`)

const updated = await sql`
  UPDATE projects SET origin = ${origin}, updatedat = updatedat
  WHERE name = ${name}
  RETURNING id, name, origin
`
console.log(`\nSet origin='${origin}' on ${updated.length} project(s). Done.`)
