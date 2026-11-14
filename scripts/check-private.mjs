#!/usr/bin/env node
// ============================================================================
// check-private.mjs — refuse to publish strings that must stay private
// ----------------------------------------------------------------------------
//   pnpm check:private
//
// Reads a private list (one string per line) from OUTSIDE the repo and fails
// if any tracked file path, file content, or unpushed commit message contains
// one of them. Matching is case-insensitive, plain substring (no regex).
//
// List location: $SPITE_PRIVATE_STRINGS_FILE, else ~/.spite/private-strings.txt
// No list = scan skipped (exit 0), so other contributors are never blocked.
//
// Hits are reported as path:line plus the entry's index and first 2 chars —
// never the full string or the matching line, because release logs get pasted.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const MAX_BYTES = 5 * 1024 * 1024
const SNIFF_BYTES = 8 * 1024

const listPath = process.env.SPITE_PRIVATE_STRINGS_FILE || join(homedir(), '.spite', 'private-strings.txt')

if (!existsSync(listPath)) {
  console.log(`Privacy scan skipped: no list at ${listPath} (create it, one string per line, or set SPITE_PRIVATE_STRINGS_FILE).`)
  process.exit(0)
}

// Keep each entry's 1-based line number in the list file as its index, so the
// report points at the exact line to look up.
const entries = []
let short = 0
readFileSync(listPath, 'utf8').split(/\r?\n/).forEach((raw, i) => {
  const s = raw.trim()
  if (!s || s.startsWith('#')) return
  if (s.length < 3) { short++; return }
  entries.push({ index: i + 1, needle: s.toLowerCase(), hint: s.slice(0, 2) + '…' })
})

if (short) console.log(`Privacy scan: ignored ${short} entr${short === 1 ? 'y' : 'ies'} shorter than 3 characters.`)
if (!entries.length) {
  console.log(`Privacy scan skipped: ${listPath} has no usable entries.`)
  process.exit(0)
}

const hits = []
const label = (e) => `entry #${e.index} (${e.hint})`

// Report every line of `text` containing an entry. `lower` is text lowercased once.
function scanText(where, text) {
  const lower = text.toLowerCase()
  let lineStarts = null
  for (const e of entries) {
    let at = lower.indexOf(e.needle)
    while (at !== -1) {
      if (!lineStarts) {
        lineStarts = [0]
        for (let i = 0; i < lower.length; i++) if (lower.charCodeAt(i) === 10) lineStarts.push(i + 1)
      }
      let lo = 0, hi = lineStarts.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= at) lo = mid; else hi = mid - 1 }
      hits.push(`${where}:${lo + 1}  ${label(e)}`)
      // Skip to the next line so one line counts once per entry.
      const nextLine = lineStarts[lo + 1]
      at = nextLine === undefined ? -1 : lower.indexOf(e.needle, nextLine)
    }
  }
}

const files = git(['ls-files', '-z']).split('\0').filter(Boolean)
let checked = 0, binary = 0, large = 0

for (const rel of files) {
  const lowerPath = rel.toLowerCase()
  for (const e of entries) {
    const at = lowerPath.indexOf(e.needle)
    // The path itself would leak the string, so mask the matching part.
    if (at !== -1) hits.push(`${rel.slice(0, at)}[…]${rel.slice(at + e.needle.length)}  (path)  ${label(e)}`)
  }

  const abs = join(root, rel)
  let st
  try { st = statSync(abs) } catch { continue } // deleted in the working tree
  if (!st.isFile()) continue
  if (st.size > MAX_BYTES) { large++; continue }
  const buf = readFileSync(abs)
  if (buf.subarray(0, SNIFF_BYTES).includes(0)) { binary++; continue }
  checked++
  scanText(rel, buf.toString('utf8'))
}

// Commit messages that would be pushed by the next release.
let commits = 0
try {
  const log = git(['log', '@{u}..HEAD', '--format=%B%x00'])
  const msgs = log.split('\0').filter((m) => m.trim())
  commits = msgs.length
  if (commits) scanText('(unpushed commit messages)', msgs.join('\n'))
} catch { /* no upstream */ }

const skipped = [binary && `${binary} binary`, large && `${large} over 5 MB`].filter(Boolean).join(', ')
const summary = `${checked} files checked${skipped ? ` (${skipped} skipped)` : ''}, ${commits} unpushed commit message${commits === 1 ? '' : 's'}, ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`

if (hits.length) {
  console.error(`Privacy scan FAILED — ${hits.length} match${hits.length === 1 ? '' : 'es'}:`)
  for (const h of hits) console.error(`  ${h}`)
  console.error(`(${summary}. Entry numbers are line numbers in ${listPath}.)`)
  process.exit(1)
}

console.log(`Privacy scan: ${summary}, no matches.`)
