-- ============================================================================
-- SPITE — Database setup script (Postgres / Neon)
-- Note: the camera_bag table (from removed Camera Bag feature) is no
-- longer created; if an existing database still has it, drop it with:
--   DROP TABLE IF EXISTS camera_bag;
-- ----------------------------------------------------------------------------
-- HOW TO USE:
--   1. Open your Neon project at https://console.neon.tech
--   2. In the left sidebar, click "SQL Editor"
--   3. Paste this ENTIRE file into the editor
--   4. Click "Run"
-- It is safe to run this more than once — it only creates things that are
-- missing and will not delete or overwrite your existing data.
-- ============================================================================

-- Projects: one row per film project on your dashboard.
CREATE TABLE IF NOT EXISTS projects (
    id          uuid PRIMARY KEY,
    userid      uuid NOT NULL,
    name        text NOT NULL DEFAULT 'Untitled Project',
    description text DEFAULT '',
    thumbnail   text,
    createdat   timestamptz NOT NULL DEFAULT now(),
    updatedat   timestamptz NOT NULL DEFAULT now()
);

-- Generation history: every AI image/video you generate, plus canvas uploads.
-- This is the "asset library" the left panel reads from. id is TEXT because the
-- app generates ids like 'asset-1700000000000-ab12cd34' as well as UUIDs.
CREATE TABLE IF NOT EXISTS generation_history (
    id             text PRIMARY KEY,
    type           text,
    model          text,
    prompt         text,
    r2_url         text,
    used_in_canvas boolean DEFAULT false,
    is_upload      boolean DEFAULT false,
    created_at     timestamptz DEFAULT now(),
    expires_at     timestamptz,
    project_id     text
);

-- Assets: project file uploads with metadata + tags (separate from the AI
-- generation history above).
CREATE TABLE IF NOT EXISTS assets (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    projectid text NOT NULL,
    name      text,
    category  text,
    url       text,
    tags      text[],
    metadata  jsonb,
    createdat timestamptz DEFAULT now(),
    updatedat timestamptz DEFAULT now()
);

-- Canvas nodes: the boxes on the node canvas, saved per project.
-- Primary key on (projectid, nodeid) so the app's UPSERT/auto-save works.
CREATE TABLE IF NOT EXISTS canvas_nodes (
    projectid  text NOT NULL,
    nodeid     text NOT NULL,
    type       text,
    position_x double precision,
    position_y double precision,
    data       jsonb,
    createdat  timestamptz DEFAULT now(),
    PRIMARY KEY (projectid, nodeid)
);

-- Canvas edges: the connections between nodes, saved per project.
CREATE TABLE IF NOT EXISTS canvas_edges (
    projectid    text NOT NULL,
    edgeid       text NOT NULL,
    source       text,
    target       text,
    sourcehandle text,
    targethandle text,
    animated     boolean,
    data         jsonb,
    createdat    timestamptz DEFAULT now(),
    PRIMARY KEY (projectid, edgeid)
);

-- Asset folders: named groups (Characters / Props / Locations / General).
-- All columns are plain text so we never run into uuid-vs-text comparison
-- pitfalls with parameter binding (the prior schema had project_id end up
-- as uuid in some installs, which broke every WHERE filter).
CREATE TABLE IF NOT EXISTS asset_folders (
    id          text PRIMARY KEY,
    project_id  text NOT NULL,
    type        text NOT NULL,
    name        text NOT NULL,
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Asset folder items: composite key on (folder_id, asset_id) — same asset
-- can't be added twice to the same folder.
CREATE TABLE IF NOT EXISTS asset_folder_items (
    folder_id  text NOT NULL REFERENCES asset_folders(id) ON DELETE CASCADE,
    asset_id   text NOT NULL,
    added_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (folder_id, asset_id)
);

-- Camera bag: saved style presets. (You said you don't need this feature, but
-- the table is created so the app never errors when that code path runs.)
CREATE TABLE IF NOT EXISTS camera_bag (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name      text NOT NULL,
    style     text NOT NULL,
    createdat timestamptz DEFAULT now(),
    updatedat timestamptz DEFAULT now()
);

-- Helpful indexes for the most common lookups.
CREATE INDEX IF NOT EXISTS idx_generation_history_project ON generation_history (project_id);
CREATE INDEX IF NOT EXISTS idx_assets_project           ON assets (projectid);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_project     ON canvas_nodes (projectid);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_project     ON canvas_edges (projectid);
CREATE INDEX IF NOT EXISTS idx_asset_folders_project    ON asset_folders (project_id);
CREATE INDEX IF NOT EXISTS idx_folder_items_folder      ON asset_folder_items (folder_id);
