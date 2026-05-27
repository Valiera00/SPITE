import { neon } from '@neondatabase/serverless'

// Lazy initialization - only create connection when needed
// This ensures DATABASE_URL is available at runtime
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}
