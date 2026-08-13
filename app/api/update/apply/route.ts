import { NextResponse } from 'next/server'

// One-click update for self-hosted installs.
//
// A deployed fork can't `git pull` itself, but GitHub can: the merge-upstream
// API fast-forwards/merges the upstream repo into the caller's fork, and the
// host (Vercel etc.) auto-redeploys off that push. So "update" = one authorized
// API call, no terminal needed.
//
// Opt-in via two env vars (see README "Updating"):
//   GITHUB_UPDATE_REPO   — your fork, e.g. "alice/SPITE"
//   GITHUB_UPDATE_TOKEN  — a fine-grained PAT with Contents read/write on that
//                          fork only. Server-side env; never sent to the client.
//   GITHUB_UPDATE_BRANCH — optional, defaults to "main".
//
// Without them the endpoint reports "not configured" and the UI falls back to
// manual instructions. The route sits behind the app's auth middleware, so only
// a logged-in owner can trigger it.

export async function POST() {
  const token = process.env.GITHUB_UPDATE_TOKEN
  const repo = process.env.GITHUB_UPDATE_REPO
  const branch = process.env.GITHUB_UPDATE_BRANCH || 'main'

  if (!token || !repo) {
    return NextResponse.json(
      {
        configured: false,
        error:
          'One-click update is not configured. Set GITHUB_UPDATE_REPO and GITHUB_UPDATE_TOKEN in your host env (see README → Updating), or sync your fork on GitHub manually.',
      },
      { status: 501 },
    )
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/merge-upstream`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'spite-app',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ branch }),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      // 200 = merged or already up to date; GitHub says which in message.
      return NextResponse.json({
        configured: true,
        merged: true,
        message: data.message || 'Fork synced with upstream.',
      })
    }

    // Map GitHub's known failure shapes to actionable messages.
    const reason =
      res.status === 409
        ? 'Your fork has local changes that conflict with upstream — resolve the merge on GitHub, then redeploy.'
        : res.status === 400
          ? 'This repo is not a fork of SPITE (merge-upstream only works on forks). Pull upstream manually instead.'
          : res.status === 404
            ? 'GitHub could not find the repo or branch — check GITHUB_UPDATE_REPO / GITHUB_UPDATE_BRANCH, and that the token can access it.'
            : data.message || `GitHub returned ${res.status}`
    return NextResponse.json({ configured: true, merged: false, error: reason }, { status: 502 })
  } catch {
    return NextResponse.json(
      { configured: true, merged: false, error: 'Could not reach GitHub — try again.' },
      { status: 502 },
    )
  }
}
