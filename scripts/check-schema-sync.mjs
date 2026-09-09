// Fails if lib/db-schema.ts no longer matches database-setup.sql.
// The app creates its tables from the TS copy; humans paste the .sql one.
import { readFileSync } from 'node:fs'

const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const fromFile = norm(readFileSync('database-setup.sql', 'utf8'))
const ts = readFileSync('lib/db-schema.ts', 'utf8')
const m = ts.match(/CORE_SCHEMA_SQL = String\.raw`([\s\S]*?)`/)
if (!m) {
  console.error('check:schema - could not find CORE_SCHEMA_SQL in lib/db-schema.ts')
  process.exit(1)
}
if (norm(m[1]) !== fromFile) {
  console.error('check:schema - database-setup.sql and lib/db-schema.ts have drifted.')
  console.error('Update the copy in lib/db-schema.ts so the app creates the same tables people get by hand.')
  process.exit(1)
}
console.log('check:schema - ok (database-setup.sql and lib/db-schema.ts match)')
