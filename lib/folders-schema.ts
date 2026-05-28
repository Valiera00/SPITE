// Auto-migrate the folder tables to the clean text-everywhere schema we
// rebuilt in commit 3c95365. Detects + drops the old uuid-flavored variant
// when it's there, and ensures both tables exist with the right shape.
//
// Called at the start of every /api/folders* route so the user never has
// to manually hit /api/folders/_setup. Module-level cache keeps it to one
// information_schema query per cold start.

let ensured = false

export async function ensureFoldersSchema(sql: any): Promise<void> {
  if (ensured) return

  // Look at the column types as they exist right now. We key the decision
  // on asset_folders.project_id: if it's uuid (or the table doesn't have
  // the columns we expect), reset. If it's text and the items table has
  // a composite PK, leave it.
  const projectIdCol = await sql`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_name = 'asset_folders' AND column_name = 'project_id'
  ` as { data_type: string }[]

  const itemsPk = await sql`
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'asset_folder_items'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND kcu.column_name IN ('folder_id', 'asset_id')
    GROUP BY tc.constraint_name
    HAVING COUNT(*) = 2
  `

  const projectIdIsText = projectIdCol.length > 0 && projectIdCol[0].data_type === 'text'
  const hasCompositePk = itemsPk.length > 0

  if (projectIdIsText && hasCompositePk) {
    // Already on the clean schema, nothing to do.
    ensured = true
    return
  }

  console.log('[folders/schema] migrating to clean schema', {
    projectIdType: projectIdCol[0]?.data_type ?? '(missing)',
    hasCompositePk,
  })

  // Drop the old tables (CASCADE handles any FK from items → folders) and
  // recreate with the clean schema. Folder data is discarded — every prior
  // save attempt was broken so there's nothing usable to preserve here.
  await sql`DROP TABLE IF EXISTS asset_folder_items CASCADE`
  await sql`DROP TABLE IF EXISTS asset_folders CASCADE`

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

  ensured = true
  console.log('[folders/schema] migration done')
}
