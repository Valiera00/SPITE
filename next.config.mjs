/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
  // Defence-in-depth response headers applied to every route. CSP is
  // deliberately not set here because the canvas pulls from fal.media,
  // fal.ai, R2 — and locking those down requires per-route policy work
  // that can wait. These four kill the cheap clickjacking / sniffing /
  // referrer-leak vectors with zero compatibility risk.
  async headers() {
    return [
      {
        source: '/:path*',
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
