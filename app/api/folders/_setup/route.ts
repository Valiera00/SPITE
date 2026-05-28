import { neon } from '@neondatabase/serverless'
import { NextResponse } from 'next/server'

// One-shot endpoint to rebuild the folder tables with a clean, simple
// text-everywhere schema. The deployed schema's project_id ended up in
// a weird state (some columns uuid, some text) that defeated repeated
// cast attempts; this resets the tables so we never have to fight the
// driver's type binding again.
//
// USAGE: from your browser devtools console while logged in, run:
//
//   fetch('/api/folders/_setup', { method: 'POST' })
//     .then(r => r.json()).then(console.log)
//
// Folder data is destroyed. Everything else (generation_history,
// canvas, etc.) is untouched.

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  return neon(process.env.DATABASE_URL)
}

export async function POST() {
  try {
    const sql = getDb()

    // Drop in dependency order. CASCADE on asset_folders also drops
    // the items table's FK, which would otherwise complain.
    await sql`DROP TABLE IF EXISTS asset_folder_items CASCADE`
    await sql`DROP TABLE IF EXISTS asset_folders CASCADE`

    // Recreate. All identifiers + project_id are plain text. No
    // implicit casts, no uuid columns, no surprises.
    await sql`
      CREATE TABLE asset_folders (
        id          text PRIMARY KEY,
        project_id  text NOT NULL,
        type        text NOT NULL,
        name        text NOT NULL,
        description text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`CREATE INDEX idx_asset_folders_project ON asset_folders (project_id)`

    await sql`
      CREATE TABLE asset_folder_items (
        folder_id  text NOT NULL REFERENCES asset_folders(id) ON DELETE CASCADE,
        asset_id   text NOT NULL,
        added_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (folder_id, asset_id)
      )
    `
    await sql`CREATE INDEX idx_asset_folder_items_asset ON asset_folder_items (asset_id)`

    return NextResponse.json({ success: true, message: 'Folder tables reset to a clean text-everywhere schema.' })
  } catch (err: any) {
    console.error('[folders/_setup] reset failed', err)
    return NextResponse.json(
      { error: 'reset failed', detail: err?.message || String(err) },
      { status: 500 },
    )
  }
}
