import { getDb } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// Namespace for the per-project canvas-save advisory lock (the int4 spells
// "SPIT"). Combined with hashtext(projectId) as the second key, it gives each
// project its own lock without colliding with the spend gate's single-bigint
// advisory lock — Postgres keeps two-int and one-bigint advisory locks in
// separate spaces.
const CANVAS_SAVE_LOCK_NS = 0x53504954

// Self-bootstraps the rolling-backup table. Snapshots are tiny insurance
// against an autosave race or accidental wipe: the last ~50 minutes of
// canvas history are recoverable via the snapshots endpoint.
// Param typed `any` to side-step Neon's deeply-generic SQL function type.
async function ensureSnapshotsSchema(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS canvas_snapshots (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  text NOT NULL,
      saved_at    timestamptz NOT NULL DEFAULT now(),
      nodes_json  jsonb NOT NULL,
      edges_json  jsonb NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_project ON canvas_snapshots(project_id, saved_at DESC)`
}

// Idempotent — adds the scenes/active_scene_id columns on projects if
// they don't exist yet. Older installs ship the projects table without
// them; lazy-creating on first canvas save means no manual migration
// step is needed for existing users.
async function ensureSceneColumns(sql: any) {
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS scenes jsonb`
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_scene_id text`
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params
    const { nodes, edges, scenes, activeSceneId } = await request.json()

    // FAILSAFE: never blow away a non-empty canvas with an empty payload.
    // The client has a matching guard but a stale request from a closed
    // tab / racing beacon / error boundary could still reach us. We let
    // an explicit ?force=true override this for the rare case the user
    // genuinely cleared the canvas to empty.
    if (Array.isArray(nodes) && nodes.length === 0) {
      const url = new URL(request.url)
      const force = url.searchParams.get('force') === 'true'
      if (!force) {
        const existing = await sql`
          SELECT COUNT(*)::int AS n FROM canvas_nodes WHERE projectId = ${projectId}::text
        `
        const existingCount = (existing[0] as any)?.n ?? 0
        if (existingCount > 0) {
          console.warn(
            `[canvas] Refusing empty-nodes save for project ${projectId}: DB has ${existingCount} nodes. Add ?force=true to override.`,
          )
          return NextResponse.json({
            success: false,
            skipped: 'empty-wipe-guard',
            existingNodes: existingCount,
          })
        }
      }
    }

    // Neon's HTTP driver runs each tagged-template invocation as its own
    // round-trip — so the old `sql\`BEGIN\`` / `sql\`COMMIT\`` pattern was
    // NOT actually atomic, just a sequence of separate statements that
    // could leave the canvas half-written on a mid-loop failure. The
    // driver's .transaction(queries[]) method, by contrast, ships every
    // query in a single HTTP request and wraps the lot in one real
    // transaction. That fixes the atomicity bug AND collapses ~60
    // round-trips on a 30-node canvas down to one.
    const writeQueries = [
      // Serialize concurrent saves for the SAME project. This save deletes all
      // of a project's nodes/edges then re-inserts them, so two overlapping
      // saves (rapid edits, the backup heartbeat landing on a normal autosave,
      // or two open tabs) would lock the same rows in different orders and
      // Postgres would abort one with "deadlock detected". A transaction-scoped
      // advisory lock keyed on the project makes the second save wait for the
      // first instead of erroring. Different projects use different keys, so
      // they never block each other.
      sql`SELECT pg_advisory_xact_lock(${CANVAS_SAVE_LOCK_NS}, hashtext(${projectId}))`,
      sql`DELETE FROM canvas_nodes WHERE projectId = ${projectId}::text`,
      sql`DELETE FROM canvas_edges WHERE projectId = ${projectId}::text`,
    ]
    for (const node of nodes) {
      writeQueries.push(sql`
        INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
        VALUES (${projectId}::text, ${node.id}, ${node.type}, ${node.position.x}, ${node.position.y}, ${JSON.stringify(node.data)})
        ON CONFLICT (projectId, nodeId) DO UPDATE SET
          type = EXCLUDED.type,
          position_x = EXCLUDED.position_x,
          position_y = EXCLUDED.position_y,
          data = EXCLUDED.data
      `)
    }
    for (const edge of edges) {
      writeQueries.push(sql`
        INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
        VALUES (${projectId}::text, ${edge.id}, ${edge.source}, ${edge.target}, ${edge.sourceHandle}, ${edge.targetHandle}, ${edge.animated}, ${JSON.stringify(edge.data || {})})
        ON CONFLICT (projectId, edgeId) DO UPDATE SET
          source = EXCLUDED.source,
          target = EXCLUDED.target,
          sourceHandle = EXCLUDED.sourceHandle,
          targetHandle = EXCLUDED.targetHandle,
          animated = EXCLUDED.animated,
          data = EXCLUDED.data
      `)
    }
    // Persist the scene list + the user's last-active scene alongside
    // the nodes/edges. Without this, adding a scene and reloading
    // resets the timeline to INITIAL_SCENES and the user's tagged
    // nodes become orphaned (sceneId references a scene that no
    // longer exists in the list).
    //
    // Sanitise: scenes is saved only when it's a non-empty array of
    // {id, name} entries; shots are derived from canvas nodes via
    // scenesWithShots and don't belong in the persisted payload.
    let scenesToSave: { id: string; name: string }[] | null = null
    if (Array.isArray(scenes) && scenes.length > 0) {
      scenesToSave = scenes
        .filter((s: any) => s && typeof s.id === 'string' && typeof s.name === 'string')
        .map((s: any) => ({ id: s.id, name: s.name }))
      if (scenesToSave.length === 0) scenesToSave = null
    }
    const activeIdToSave =
      typeof activeSceneId === 'string' && activeSceneId
        ? activeSceneId
        : null

    // Lazy-create the scene columns BEFORE the transaction. ALTER TABLE
    // inside a tagged-template transaction would lock for longer than
    // we want, and these calls are no-ops after the first cold start.
    await ensureSceneColumns(sql)

    // Touch the project so the dashboard's "last edited" timestamp +
    // most-recently-used sort actually reflect canvas activity, not just
    // explicit project metadata changes (rename / create / duplicate).
    // Scenes + active scene id ride along on the same UPDATE so they
    // commit atomically with the nodes/edges writes.
    writeQueries.push(sql`
      UPDATE projects
      SET updatedat = NOW(),
          scenes = COALESCE(${scenesToSave ? JSON.stringify(scenesToSave) : null}::jsonb, scenes),
          active_scene_id = COALESCE(${activeIdToSave}, active_scene_id)
      WHERE id = ${projectId}
    `)
    await sql.transaction(writeQueries)

    // Rolling-backup snapshot: write the just-saved state to a separate
    // snapshots table so we can recover from a botched save / accidental
    // wipe. Throttled to one snapshot per 5 minutes per project to avoid
    // filling the rolling window with near-identical states during rapid
    // editing, capped to the most recent 30 snapshots per project —
    // roughly 2.5 hours of recoverable history, comfortable for a long
    // editing session. Any failure here is non-fatal — the main save
    // already succeeded.
    try {
      await ensureSnapshotsSchema(sql)
      const lastSnap = await sql`
        SELECT saved_at FROM canvas_snapshots
        WHERE project_id = ${projectId}
        ORDER BY saved_at DESC LIMIT 1
      `
      const lastTs = (lastSnap[0] as any)?.saved_at
      const tooSoon =
        lastTs && Date.now() - new Date(lastTs).getTime() < 5 * 60 * 1000
      if (!tooSoon) {
        await sql`
          INSERT INTO canvas_snapshots (project_id, nodes_json, edges_json)
          VALUES (
            ${projectId},
            ${JSON.stringify(nodes)}::jsonb,
            ${JSON.stringify(edges)}::jsonb
          )
        `
        await sql`
          DELETE FROM canvas_snapshots
          WHERE project_id = ${projectId}
            AND id IN (
              SELECT id FROM canvas_snapshots
              WHERE project_id = ${projectId}
              ORDER BY saved_at DESC
              OFFSET 30
            )
        `
      }
    } catch (snapErr) {
      console.error('[canvas] Snapshot write failed (non-fatal):', snapErr)
    }

    // Reconcile asset protection: anything referenced by a node on the canvas
    // is "protected" (never auto-deleted); anything previously protected in
    // this project but no longer on the canvas gets a fresh 30-day window.
    try {
      const urls = new Set<string>()
      const ids = new Set<string>()
      for (const node of nodes) {
        const d = (node && node.data) || {}
        if (typeof d.outputUrl === 'string' && d.outputUrl) urls.add(d.outputUrl)
        if (typeof d.thumbnail === 'string' && d.thumbnail) urls.add(d.thumbnail)
        if (typeof d.assetId === 'string' && d.assetId) ids.add(d.assetId)
      }
      const urlArr = Array.from(urls)
      const idArr = Array.from(ids)

      if (urlArr.length || idArr.length) {
        await sql`
          UPDATE generation_history
          SET used_in_canvas = true, expires_at = NULL
          WHERE project_id = ${projectId}
            AND (r2_url = ANY(${urlArr}::text[]) OR id = ANY(${idArr}::text[]))
        `
      }

      // Folder membership is sticky protection too. Re-promote any folder
      // member that was previously demoted (e.g. by an earlier autosave
      // that didn't yet know about folders). Cheap — the EXISTS subquery
      // is keyed by asset_id which is the FK target.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = true, expires_at = NULL
        WHERE project_id = ${projectId}
          AND (used_in_canvas = false OR expires_at IS NOT NULL)
          AND EXISTS (
            SELECT 1 FROM asset_folder_items fi WHERE fi.asset_id = generation_history.id
          )
      `

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      // Demote assets no longer on the canvas back to a 30-day temp life
      // — UNLESS they're also a member of a folder. Folder membership is
      // a separate, sticky protection: the user explicitly filed them
      // under Characters/Props/Locations/General and expects them to
      // survive cleanup until manually deleted.
      await sql`
        UPDATE generation_history
        SET used_in_canvas = false, expires_at = ${expiresAt}
        WHERE project_id = ${projectId}
          AND used_in_canvas = true
          AND NOT (r2_url = ANY(${urlArr}::text[]) OR id = ANY(${idArr}::text[]))
          AND NOT EXISTS (
            SELECT 1 FROM asset_folder_items fi WHERE fi.asset_id = generation_history.id
          )
      `
    } catch (reconcileErr) {
      // Never fail the save because of reconciliation.
      console.error('[canvas] Protection reconcile failed:', reconcileErr)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving canvas:', error)
    return NextResponse.json({ error: 'Failed to save canvas' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const sql = getDb()
    const { projectId } = await params

    // Make sure the scene columns exist before we read them. Idempotent
    // ALTER — no-op after the first cold start of this serverless
    // instance. Also keeps existing installs working without a manual
    // migration step.
    await ensureSceneColumns(sql)

    // Fetch nodes (cast to text to avoid UUID inference)
    const nodesResult = await sql`
      SELECT nodeId as id, type, position_x, position_y, data
      FROM canvas_nodes
      WHERE projectId = ${projectId}::text
      ORDER BY createdAt
    `

    // Fetch edges (column names are lowercase in PostgreSQL)
    const edgesResult = await sql`
      SELECT edgeid as id, source, target, sourcehandle, targethandle, animated, data
      FROM canvas_edges
      WHERE projectId = ${projectId}::text
      ORDER BY createdAt
    `

    // Fetch scene list + last-active scene id. Falls back to a single
    // default Scene 1 if the project hasn't saved scenes yet (new
    // project, or pre-migration project on its first load after the
    // scene-persistence change).
    const projectMeta = await sql`
      SELECT scenes, active_scene_id FROM projects WHERE id = ${projectId}
    `
    const savedScenes = (projectMeta[0] as any)?.scenes as
      | { id: string; name: string }[]
      | null
      | undefined
    const scenes =
      Array.isArray(savedScenes) && savedScenes.length > 0
        ? savedScenes
        : [{ id: 'scene-1', name: 'Scene 1' }]
    const activeSceneId =
      ((projectMeta[0] as any)?.active_scene_id as string | null) ||
      scenes[0]?.id ||
      'scene-1'

    const nodes = nodesResult.map((row: any) => ({
      id: row.id,
      type: row.type,
      position: { x: row.position_x, y: row.position_y },
      data: row.data || {},
    }))

    const edges = edgesResult.map((row: any) => ({
      id: row.id,
      source: row.source,
      target: row.target,
      sourceHandle: row.sourcehandle,
      targetHandle: row.targethandle,
      animated: row.animated,
      data: row.data || {},
    }))

    return NextResponse.json({ nodes, edges, scenes, activeSceneId })
  } catch (error) {
    console.error('Error loading canvas:', error)
    return NextResponse.json({ error: 'Failed to load canvas' }, { status: 500 })
  }
}
