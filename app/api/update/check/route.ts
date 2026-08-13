import { NextResponse } from 'next/server'

// Is a newer SPITE release out? Compares the running build's version against
// the latest *published* GitHub release of the upstream repo (drafts and
// prereleases never show, so an unpublished draft can't nag anyone).
//
// Result is cached for an hour so a busy session doesn't hammer GitHub's
// unauthenticated rate limit (60/h per IP is plenty at this cadence).

const UPSTREAM_REPO = 'Valiera00/SPITE'

function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest)
  const b = parseSemver(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

export async function GET() {
  const current = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  try {
    const res = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'spite-app' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      // No releases yet, rate-limited, offline — all fine, just report no update.
      return NextResponse.json({ current, updateAvailable: false })
    }
    const rel = await res.json()
    const latest = String(rel.tag_name || '').replace(/^v/i, '')
    return NextResponse.json({
      current,
      latest,
      updateAvailable: isNewer(latest, current),
      releaseUrl: rel.html_url || `https://github.com/${UPSTREAM_REPO}/releases`,
      releaseName: rel.name || `v${latest}`,
      publishedAt: rel.published_at || null,
    })
  } catch {
    return NextResponse.json({ current, updateAvailable: false })
  }
}
