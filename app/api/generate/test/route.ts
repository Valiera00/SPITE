import { NextResponse } from 'next/server'

// HOTFIX (incident: silent fal charges): this route previously did
// `fal.queue.submit('fal-ai/flux/schnell', { input: { prompt: 'test' } })`
// and tried to immediately cancel — but the cancel was best-effort with
// a swallowed try/catch, and the call ran on EVERY Settings page mount
// via useEffect. Result: every visit to /settings could leak a fal
// submission. No more. We only check that the key env var is present
// and report a masked preview. The real validity check happens
// implicitly the first time the user actually generates something.
export async function POST() {
  const key = process.env.FAL_KEY
  if (!key) {
    return NextResponse.json({
      connected: false,
      error: 'FAL_KEY environment variable not set',
    })
  }
  return NextResponse.json({
    connected: true,
    keyPreview: `****${key.slice(-4)}`,
    note: 'Key presence verified. Validity will be confirmed at first generate.',
  })
}
