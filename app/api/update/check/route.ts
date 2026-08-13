import { NextRequest, NextResponse } from 'next/server'

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

export async function GET(request: NextRequest) {
  // Test hook (mirrors ?tour=): `?as=0.1.0` pretends the running build is that
  // version, so the notice/update flow can be exercised against the real
  // GitHub release data without deploying an old build. Read-only, auth-gated.
  const pretend = request.nextUrl.searchParams.get('as')
  const current =
    pretend && parseSemver(pretend)
      ? pretend
      : process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
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
      // The release notes (markdown), so "What's new" can render in-app.
      notes: typeof rel.body === 'string' ? rel.body.slice(0, 4000) : '',
    })
  } catch {
    return NextResponse.json({ current, updateAvailable: false })
  }
}
