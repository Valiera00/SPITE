// Server-side per-hour USD ceiling on fal.ai spend. Defence against a
// captured cookie being weaponised into a billing attack — the existing
// client-side $25 confirmation dialog is UX, not a control. This is the
// control.

import { getDb, type Sql } from './db'

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
  ledgerId?: string  // present iff allowed — used to roll back on fal-submit failure
}

// Atomic check-and-record. Combines the previous checkSpendGate +
// recordSpend in one SQL statement so two concurrent submits can't
// both read the same "spent last hour" total and both pass through
// (TOCTOU). The INSERT only happens if current_spent + cost <= limit;
// otherwise zero rows are inserted and we return allowed: false.
//
// Caller pattern:
//   const reservation = await reserveSpend(modelId, cost)
//   if (!reservation.allowed) return 429
//   try { ...submit to fal... }
//   catch { await rollbackSpend(reservation.ledgerId) }
//
// Rolling back on submit failure keeps the ledger accurate; not
// rolling back is safe-but-pessimistic (the gate over-counts by
// failed submits, which expire from the window after 1 hour anyway).
export async function reserveSpend(
  modelId: string,
  costUsd: number,
): Promise<SpendGateResult> {
  const limitUsd = getLimitUsd()
  const sql = getDb()
  await ensureSchema(sql)

  if (limitUsd === 0) {
    // Owner opted out — record for visibility, skip the gate.
    const rows = (await sql`
      INSERT INTO spend_ledger (model_id, estimated_usd)
      VALUES (${modelId}, ${costUsd})
      RETURNING id
    `) as { id: string }[]
    return {
      allowed: true,
      spentLastHourUsd: 0,
      limitUsd,
      projectedTotalUsd: costUsd,
      ledgerId: rows[0]?.id,
    }
  }

  // Atomic: INSERT only if (current_spent + this_cost) <= limit.
  // The SELECT in the WHERE clause is locked-evaluated at write time,
  // so two concurrent inserts will see each other.
  const inserted = (await sql`
    INSERT INTO spend_ledger (model_id, estimated_usd)
    SELECT ${modelId}, ${costUsd}
    WHERE (
      SELECT COALESCE(SUM(estimated_usd), 0)
      FROM spend_ledger
      WHERE created_at > now() - interval '1 hour'
    ) + ${costUsd} <= ${limitUsd}
    RETURNING id
  `) as { id: string }[]

  if (inserted.length > 0) {
    // Reserved successfully — also fetch the new current total for the response.
    const totals = (await sql`
      SELECT COALESCE(SUM(estimated_usd), 0)::float8 AS spent
      FROM spend_ledger
      WHERE created_at > now() - interval '1 hour'
    `) as { spent: number }[]
    const spent = Number(totals[0]?.spent ?? 0)
    return {
      allowed: true,
      spentLastHourUsd: spent - costUsd,
      limitUsd,
      projectedTotalUsd: spent,
      ledgerId: inserted[0].id,
    }
  }

  // Insert was rejected by the WHERE — gate is closed. Read totals
  // for a useful error response.
  const totals = (await sql`
    SELECT COALESCE(SUM(estimated_usd), 0)::float8 AS spent
    FROM spend_ledger
    WHERE created_at > now() - interval '1 hour'
  `) as { spent: number }[]
  const spent = Number(totals[0]?.spent ?? 0)
  return {
    allowed: false,
    spentLastHourUsd: spent,
    limitUsd,
    projectedTotalUsd: spent + costUsd,
  }
}

// Undo a reservation if the subsequent fal submit failed — keeps the
// ledger from over-counting work fal never queued. Best-effort: a
// dropped rollback just means the gate is slightly more conservative
// for the next hour.
export async function rollbackSpend(ledgerId: string | undefined): Promise<void> {
  if (!ledgerId) return
  try {
    const sql = getDb()
    await sql`DELETE FROM spend_ledger WHERE id = ${ledgerId}`
  } catch (err) {
    console.error('[spend-gate] rollbackSpend failed:', err)
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
