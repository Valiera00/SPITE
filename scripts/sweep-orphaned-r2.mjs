#!/usr/bin/env node
// ============================================================================
// sweep-orphaned-r2.mjs — reclaim R2 storage left behind by old deletes
// ----------------------------------------------------------------------------
// Lists every object in your R2 bucket, builds the set of keys still
// referenced anywhere in the database, and reports (or deletes) the objects
// that nothing references anymore — the orphans that older versions of
// project-delete left behind.
//
// DRY RUN BY DEFAULT. It will not delete anything unless you pass --delete.
//
//   node scripts/sweep-orphaned-r2.mjs            # list orphans + total size
//   node scripts/sweep-orphaned-r2.mjs --delete   # actually delete them
//
// Reads credentials from .env.local (same file the app uses): DATABASE_URL,
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
//
// Safety: it refuses to delete if the "referenced" set comes back empty while
// the bucket has objects — that almost always means the DB query failed or
// pointed at the wrong database, and deleting everything would be a disaster.
// ============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'

const DELETE = process.argv.includes('--delete')

// --- Load .env.local (no dotenv dependency) ---------------------------------
function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  const envPath = join(here, '..', '.env.local')
  let raw
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    console.error(`Could not read ${envPath}. Run this from the repo with a populated .env.local.`)
    process.exit(1)
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val
  }
}
loadEnv()

for (const k of ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in .env.local`)
    process.exit(1)
  }
}

const BUCKET = process.env.R2_BUCKET_NAME
const sql = neon(process.env.DATABASE_URL)
const s3 = new S3Client({
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// Pull every R2 key out of a blob of text (a stored URL or a whole JSON
// document). Matches the app's proxy form `/api/r2-image/<key>` and the bare
// `/uploads/<file>` form. Stops at quotes, whitespace, query strings, or
// backslashes so it never grabs trailing JSON punctuation.
function extractKeys(text, into) {
  if (!text) return
  const proxy = /\/api\/r2-image\/([^"'\s?\\]+)/g
  let m
  while ((m = proxy.exec(text))) into.add(decodeURIComponent(m[1]))
  const uploads = /(?<!r2-image\/)\/uploads\/([^"'\s?\\]+)/g
  while ((m = uploads.exec(text))) into.add('uploads/' + decodeURIComponent(m[1]))
}

async function buildReferencedSet() {
  const refs = new Set()

  const gh = await sql`SELECT r2_url FROM generation_history WHERE r2_url IS NOT NULL`
  for (const r of gh) extractKeys(r.r2_url, refs)

  const assets = await sql`SELECT url FROM assets WHERE url IS NOT NULL`
  for (const r of assets) extractKeys(r.url, refs)

  const projects = await sql`SELECT thumbnail FROM projects WHERE thumbnail IS NOT NULL`
  for (const r of projects) extractKeys(r.thumbnail, refs)

  // Whole-JSON scan of canvas data — catches outputUrl, thumbnail, output
  // arrays, and any nested reference we don't model explicitly.
  const nodes = await sql`SELECT data::text AS t FROM canvas_nodes WHERE data IS NOT NULL`
  for (const r of nodes) extractKeys(r.t, refs)
  const edges = await sql`SELECT data::text AS t FROM canvas_edges WHERE data IS NOT NULL`
  for (const r of edges) extractKeys(r.t, refs)

  return refs
}

async function listAllObjects() {
  const out = []
  let token
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: token,
    }))
    for (const o of res.Contents || []) out.push({ Key: o.Key, Size: o.Size || 0 })
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}

function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}

async function main() {
  console.log(`Mode: ${DELETE ? 'DELETE' : 'DRY RUN (no deletions)'}`)
  console.log('Building referenced-key set from the database…')
  const referenced = await buildReferencedSet()
  console.log(`  ${referenced.size} keys are referenced somewhere.`)

  console.log(`Listing objects in bucket "${BUCKET}"…`)
  const objects = await listAllObjects()
  console.log(`  ${objects.length} objects in the bucket.`)

  const orphans = objects.filter((o) => !referenced.has(o.Key))
  const orphanBytes = orphans.reduce((s, o) => s + o.Size, 0)

  console.log('')
  console.log(`Orphans: ${orphans.length} object(s), ${human(orphanBytes)} reclaimable.`)
  for (const o of orphans.slice(0, 50)) console.log(`  ${o.Key}  (${human(o.Size)})`)
  if (orphans.length > 50) console.log(`  … and ${orphans.length - 50} more`)

  if (!orphans.length) {
    console.log('Nothing to do.')
    return
  }

  // Disaster guard: an empty referenced set with a non-empty bucket means the
  // DB lookup almost certainly failed — refuse to nuke everything.
  if (referenced.size === 0) {
    console.error('\nABORT: referenced set is empty but the bucket has objects.')
    console.error('That looks like a bad DATABASE_URL or a failed query, not a truly empty DB.')
    process.exit(1)
  }

  if (!DELETE) {
    console.log('\nDry run only. Re-run with --delete to remove the objects above.')
    return
  }

  console.log('\nDeleting…')
  let deleted = 0
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000)
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch.map((o) => ({ Key: o.Key })), Quiet: true },
    }))
    deleted += batch.length
    console.log(`  ${deleted}/${orphans.length}`)
  }
  console.log(`Done. Reclaimed ${human(orphanBytes)} across ${deleted} object(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
