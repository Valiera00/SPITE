import { NextResponse } from 'next/server'
import { byteplusRoutedModelIds } from '@/lib/byteplus'

// Which SPITE models the submit route sends somewhere other than fal, so the
// browser can price them correctly. Says nothing about keys beyond "routed".
export async function GET() {
  const routed: Record<string, string> = {}
  for (const id of byteplusRoutedModelIds()) routed[id] = 'byteplus'
  return NextResponse.json({ routed })
}
