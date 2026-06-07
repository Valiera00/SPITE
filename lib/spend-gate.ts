// Server-side per-hour USD ceiling on fal.ai spend. Defence against a
// captured cookie being weaponised into a billing attack — the existing
// client-side $25 confirmation dialog is UX, not a control. This is the
// control.

import { neon } from '@neondatabase/serverless'

type Sql = ReturnType<typeof neon>

function getDb(): Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set')
  }
  return neon(process.env.DATABASE_URL)
}

let schemaEnsured = false
async function ensureSchema(sql: Sql) {
  if (schemaEnsured) return
  await sql`
    CREATE TABLE IF NOT EXISTS spend_ledger (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id       text NOT NULL,
      estimated_usd  numeric(10,4) NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_spend_ledger_time ON spend_ledger (created_at)`
  schemaEnsured = true
}

// Default ceiling. Set SPEND_LIMIT_USD_PER_HOUR to override. $100/hr
// gives a working AI-filmmaker session real room (Nano Banana batches
// plus a generous video allowance: roughly 22 Seedance shots/hr) while
// still capping a runaway loop or compromised cookie at a bounded
// loss. Raise via env for unusual projects, or set to 0 to disable.
const DEFAULT_LIMIT_USD = 100

function getLimitUsd(): number {
  const raw = process.env.SPEND_LIMIT_USD_PER_HOUR
  if (raw === undefined || raw === '') return DEFAULT_LIMIT_USD
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LIMIT_USD
  return n
}

export interface SpendGateResult {
  allowed: boolean
  spentLastHourUsd: number
  limitUsd: number
  projectedTotalUsd: number
}

// Throw-style API would be cleaner here, but the caller benefits from
// the numbers (to put in a useful error response), so return them.
export async function checkSpendGate(costUsd: number): Promise<SpendGateResult> {
  const limitUsd = getLimitUsd()
  if (limitUsd === 0) {
    // Owner opted out.
    return { allowed: true, spentLastHourUsd: 0, limitUsd, projectedTotalUsd: costUsd }
  }
  const sql = getDb()
  await ensureSchema(sql)
  const rows = (await sql`
    SELECT COALESCE(SUM(estimated_usd), 0)::float8 AS spent
    FROM spend_ledger
    WHERE created_at > now() - interval '1 hour'
  `) as { spent: number }[]
  const spentLastHourUsd = Number(rows[0]?.spent ?? 0)
  const projectedTotalUsd = spentLastHourUsd + costUsd
  return {
    allowed: projectedTotalUsd <= limitUsd,
    spentLastHourUsd,
    limitUsd,
    projectedTotalUsd,
  }
}

export async function recordSpend(modelId: string, costUsd: number): Promise<void> {
  try {
    const sql = getDb()
    await ensureSchema(sql)
    await sql`
      INSERT INTO spend_ledger (model_id, estimated_usd)
      VALUES (${modelId}, ${costUsd})
    `
  } catch (err) {
    console.error('[spend-gate] recordSpend failed:', err)
  }
}

// Background sweep from the cleanup cron — drop rows beyond the
// rate-limit window so the table doesn't grow indefinitely.
export async function purgeOldSpendLedger(): Promise<number> {
  const sql = getDb()
  await ensureSchema(sql)
  const deleted = (await sql`
    DELETE FROM spend_ledger WHERE created_at < now() - interval '7 days' RETURNING id
  `) as unknown[]
  return deleted.length
}
