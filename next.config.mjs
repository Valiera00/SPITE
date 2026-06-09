/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Type errors fail the build. The codebase is TS-strict and currently
    // type-clean, so this just stops a future type regression from silently
    // shipping. If a forker's build ever fails here, the error message tells
    // them exactly what to fix — don't flip this back to true to paper over it.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  // Expose the commit SHA to the client so the login footer can show
  // which build is live. Vercel injects VERCEL_GIT_COMMIT_SHA on every
  // deploy; local dev falls through to 'dev'.
  env: {
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
  },
  // Defence-in-depth response headers. Scoped to HTML/page routes only
  // — API routes (especially /api/r2-image) set their own headers and
  // pile-on globals can break third-party fetchers like fal.ai's image
  // downloader. CSP intentionally not set yet; needs per-route work.
  async headers() {
    return [
      {
        source: '/((?!api/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
