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
}

export default nextConfig
