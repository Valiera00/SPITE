#!/usr/bin/env node
// ============================================================================
// release.mjs — cut a release the way this repo already works
// ----------------------------------------------------------------------------
//   pnpm release           # patch: 0.3.0 -> 0.3.1
//   pnpm release minor     # 0.3.0 -> 0.4.0
//   pnpm release major     # 0.3.0 -> 1.0.0
//   pnpm release 1.2.3     # explicit version
//
// Does, in order: refuse on a dirty tree -> bump package.json -> BUILD (the gate;
// nothing ships if the build fails) -> commit -> tag -> fast-forward main ->
// push both branches with the tag -> open a DRAFT GitHub release.
//
// The GitHub release is left as a DRAFT on purpose: publishing is outward-facing,
// so you review the notes and hit Publish yourself.
// ============================================================================

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', ...opts }).trim()
const loud = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })

// Where this repo develops vs. what it publishes from.
const WORK_BRANCH = 'spite-rebrand'
const MAIN_BRANCH = 'main'

if (run('git status --porcelain')) {
  console.error('Working tree is dirty — commit or stash first.')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [maj, min, pat] = pkg.version.split('.').map(Number)

const arg = (process.argv[2] || 'patch').toLowerCase()
const next =
  arg === 'major' ? `${maj + 1}.0.0`
  : arg === 'minor' ? `${maj}.${min + 1}.0`
  : arg === 'patch' ? `${maj}.${min}.${pat + 1}`
  : /^\d+\.\d+\.\d+$/.test(arg) ? arg
  : null

if (!next) {
  console.error(`Unrecognised version "${arg}". Use major | minor | patch | X.Y.Z`)
  process.exit(1)
}

const prev = pkg.version
console.log(`\nReleasing v${prev} -> v${next}\n`)

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// Build gate: a failed build must not become a tagged release.
try {
  console.log('Building…')
  loud('pnpm build')
} catch {
  pkg.version = prev
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.error('\nBuild failed — version reverted, nothing pushed.')
  process.exit(1)
}

try { run('git checkout -- next-env.d.ts') } catch { /* not always present */ }

run('git add package.json')
run(`git commit -q -m "Release v${next}"`)
run(`git tag -a v${next} -m "v${next}"`)

// Keep main in lock-step with the work branch, then push both plus the tag.
const current = run('git rev-parse --abbrev-ref HEAD')
if (current === WORK_BRANCH) {
  run(`git checkout ${MAIN_BRANCH}`)
  run(`git merge --ff-only ${WORK_BRANCH}`)
  run(`git checkout ${WORK_BRANCH}`)
  loud(`git push origin ${WORK_BRANCH}`)
}
loud(`git push origin ${MAIN_BRANCH} --follow-tags`)

// Draft release with the commit log since the previous tag as a starting point.
let notes = ''
try {
  notes = run(`git log v${prev}..v${next} --no-merges --pretty=format:"- %s"`)
} catch { /* first release, or missing previous tag */ }

try {
  execSync(
    `gh release create v${next} --draft --target ${MAIN_BRANCH} --title "v${next}" --notes ${JSON.stringify(notes || `Release v${next}`)}`,
    { cwd: root, stdio: 'inherit' },
  )
  console.log(`\nDraft release v${next} created — review the notes and hit Publish on GitHub.`)
} catch {
  console.log(`\nTag v${next} pushed. (Could not create the GitHub release — run "gh auth status" and create it manually.)`)
}
