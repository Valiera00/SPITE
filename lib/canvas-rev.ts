// A counter on each project that goes up every time its canvas is written
// (an autosave, or a snapshot restore). A tab remembers the number it last
// loaded or saved; if the project's number has moved on, another tab or device
// has written the board since, and this tab's copy is out of date.
//
// Today it guards one thing: an open canvas only takes shots from the board
// inbox (hooks/use-board-inbox.ts) when it is current, because adding a node
// makes the tab autosave, and an out-of-date tab's autosave would replace
// newer work with its old copy.

import { getDb, type Sql } from './db'

let ready = false
/** Adds the column on installs that predate it. Once per instance. */
export async function ensureCanvasRev(sql: Sql): Promise<void> {
  if (ready) return
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS canvas_rev bigint NOT NULL DEFAULT 0`
  ready = true
}

/** The project's current canvas revision, or null if the project doesn't exist. */
export async function getCanvasRev(projectId: string): Promise<number | null> {
  const sql = getDb()
  await ensureCanvasRev(sql)
  const rows = await sql`SELECT canvas_rev FROM projects WHERE id::text = ${projectId} LIMIT 1`
  return rows.length ? Number(rows[0].canvas_rev) || 0 : null
}
