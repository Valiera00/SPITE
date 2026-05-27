import { NextResponse } from 'next/server'
import { fal } from '@fal-ai/client'

export async function POST() {
  try {
    if (!process.env.FAL_KEY) {
      return NextResponse.json({
        connected: false,
        error: 'FAL_KEY environment variable not set',
      })
    }

    // Configure and test connection with a lightweight call
    fal.config({
      credentials: process.env.FAL_KEY,
    })

    // Use a simple API call to verify the key works
    // We'll just check if we can access the API without actually generating
    const testResult = await fal.queue.submit('fal-ai/flux/schnell', {
      input: { prompt: 'test' },
    })

    // Immediately cancel to avoid charges
    if (testResult.request_id) {
      try {
        await fal.queue.cancel('fal-ai/flux/schnell', { requestId: testResult.request_id })
      } catch {
        // Ignore cancel errors
      }
    }

    return NextResponse.json({
      connected: true,
      keyPreview: `****${process.env.FAL_KEY.slice(-4)}`,
    })
  } catch (error: any) {
    console.error('[fal.ai] Connection test error:', error)
    return NextResponse.json({
      connected: false,
      error: error.message || 'Invalid API key',
    })
  }
}
