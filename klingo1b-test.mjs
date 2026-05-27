import { neon } from '@neondatabase/serverless'
const BASE = 'http://localhost:3000'
const COOKIE = 'frame_session=authenticated'
const sql = neon(process.argv[2])
const h = { 'Content-Type': 'application/json', Cookie: COOKIE }
const log = (...a) => console.log(...a)
async function main() {
  const proj = await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'KLINGO1B TEST' }) })).json()
  const pid = proj.id
  // TEXT-ONLY (no reference image) — the "does it generate output" test case
  const sub = await (await fetch(`${BASE}/api/generate/submit`, { method: 'POST', headers: h, body: JSON.stringify({ modelId: 'kling-o1', prompt: 'a golden retriever puppy in a field, photorealistic', settings: { aspectRatio: '1:1' } }) })).json()
  log('submit (text-only) ->', JSON.stringify(sub))
  if (!sub.request_id) { log('NO request_id — submit REJECTED:', JSON.stringify(sub)); await cleanup(pid); return }
  const start = Date.now()
  let done = false
  for (let i = 0; i < 30; i++) {
    const st = await (await fetch(`${BASE}/api/generate/status?request_id=${sub.request_id}&model=${encodeURIComponent(sub.model)}&projectId=${pid}&prompt=test`, { headers: { Cookie: COOKIE } })).json()
    const secs = Math.round((Date.now() - start) / 1000)
    log(`  ${secs}s: ${st.status || JSON.stringify(st).slice(0,150)}`)
    if (st.status === 'COMPLETED') { log('  DONE:', st.output?.url); done = true; break }
    if (st.status === 'FAILED' || st.error) { log('  FAILED/ERROR:', JSON.stringify(st).slice(0,250)); done = true; break }
    await new Promise(r => setTimeout(r, 3000))
  }
  if (!done) log('  STILL not terminal after ~90s')
  await cleanup(pid)
}
async function cleanup(pid){ await sql`DELETE FROM generation_history WHERE project_id=${pid}`; await sql`DELETE FROM projects WHERE id=${pid}`; log('cleaned up.') }
main().catch(e => console.error('ERR', e))
