import { NextRequest, NextResponse } from 'next/server'
import { verifyMcpAuthHeader } from '@/lib/mcp/access'
import { SERVER_INSTRUCTIONS, callTool, listTools } from '@/lib/mcp/tools'

// SPITE's MCP endpoint: lets the owner's own Claude work in SPITE. Off until a
// token is created in Settings → Claude connection; every request must carry
// it. The login-cookie gate (proxy.ts) lets this path through because an MCP
// client has no cookie — the token check below is the gate here.
//
// Transport: MCP "Streamable HTTP", stateless. Each POST carries one JSON-RPC
// message and gets one JSON response. There is no server-to-client stream, so
// GET answers 405, which the spec allows for servers that don't offer one.
// Nothing is kept between requests but what the tools store in the database,
// so it runs the same on a long-lived server and on serverless.

export const dynamic = 'force-dynamic'
// check_jobs can wait for results (up to 40s) and looks at images.
export const maxDuration = 60

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'spite', title: 'SPITE', version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0' }

type Id = string | number | null
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result })
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } })

function unauthorized() {
  return NextResponse.json(
    { error: 'This SPITE’s Claude connection is off, or the token is wrong. Turn it on in Settings → Claude connection.' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="SPITE MCP"', 'Cache-Control': 'no-store' } },
  )
}

async function handle(message: unknown): Promise<object | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return fail(null, -32600, 'Invalid request')
  const { id, method, params } = message as { id?: Id; method?: unknown; params?: Record<string, unknown> }
  // No id = a notification (e.g. notifications/initialized): nothing to answer.
  const isNotification = id === undefined
  if (typeof method !== 'string') return isNotification ? null : fail(id ?? null, -32600, 'Invalid request')
  if (isNotification) return null
  const rid: Id = id ?? null

  switch (method) {
    case 'initialize': {
      const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
      return ok(rid, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(rid, {})
    case 'tools/list':
      return ok(rid, { tools: listTools() })
    case 'tools/call': {
      const name = typeof params?.name === 'string' ? params.name : ''
      const result = await callTool(name, params?.arguments)
      return result ? ok(rid, result) : fail(rid, -32602, `Unknown tool: ${name}`)
    }
    default:
      return fail(rid, -32601, `Method not found: ${method}`)
  }
}

export async function POST(request: NextRequest) {
  if (!(await verifyMcpAuthHeader(request.headers.get('authorization')))) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(fail(null, -32700, 'Parse error'), { status: 400 })
  }

  const headers = { 'Cache-Control': 'no-store' }
  // A batch is answered as a batch; messages run one at a time, in order.
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) return NextResponse.json(fail(null, -32600, 'Invalid request'), { status: 400 })
    const replies: object[] = []
    for (const m of body) {
      const r = await handle(m)
      if (r) replies.push(r)
    }
    return replies.length ? NextResponse.json(replies, { headers }) : new NextResponse(null, { status: 202, headers })
  }
  const reply = await handle(body)
  return reply ? NextResponse.json(reply, { headers }) : new NextResponse(null, { status: 202, headers })
}

const noStream = () => new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
export const GET = noStream
export const DELETE = noStream
