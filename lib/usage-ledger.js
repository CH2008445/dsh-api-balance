/**
 * Usage ledger: running token totals and cost for one process lifetime.
 *
 * Written to a file so a plugin reload does not discard a session's totals, and
 * so the DSH home folder stays the single place usage data lives. Writes are
 * debounced and atomic.
 */

import fs from 'node:fs'
import path from 'node:path'
import { emptyTotal } from './pricing.js'

/** Ledger schema version; a mismatched file is discarded rather than migrated. */
const VERSION = 1

/** Debounce window for persisting the ledger, in milliseconds. */
const WRITE_DELAY_MS = 2000

/** Cap on retained per-model rows, so a long session cannot grow the file without bound. */
const MAX_MODELS = 50

/**
 * Resolve the ledger path under the DSH home folder.
 * @param home - DSH home directory.
 * @returns Absolute path to the ledger file.
 */
export function ledgerPath(home) {
  return path.join(home, 'storages', 'api-balance', 'usage.json')
}

/**
 * Coerce an unknown value into a usable total.
 * @param value - Candidate total.
 * @returns A valid total with absent fields read as zero.
 */
function reviveTotal(value) {
  const total = emptyTotal()
  if (value === null || typeof value !== 'object') return total
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'calls', 'cost']) {
    const n = value[key]
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) total[key] = n
  }
  return total
}

/**
 * Open the usage ledger for this process lifetime.
 *
 * @param home - DSH home directory; the ledger is skipped when absent.
 * @param startedAt - Epoch milliseconds this process started.
 * @returns A ledger handle with record, snapshot, and reset operations.
 */
export function openLedger(home, startedAt) {
  const file = typeof home === 'string' && home.length > 0 ? ledgerPath(home) : null
  const total = emptyTotal()
  const models = new Map()
  const sessionIds = new Set()
  let timer = null
  let lastError = null

  // Restore only totals recorded by the same process start. A ledger left by an
  // earlier run is history, not this run's usage, so it is not added in.
  if (file !== null) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed?.version === VERSION && parsed.startedAt === startedAt) {
        Object.assign(total, reviveTotal(parsed.total))
        for (const [id, value] of Object.entries(parsed.models ?? {})) models.set(id, reviveTotal(value))
        if (Array.isArray(parsed.sessions)) {
          for (const id of parsed.sessions) if (typeof id === 'string' && id.length > 0) sessionIds.add(id)
        }
      }
    } catch {
      // A missing, unreadable, or older ledger starts a fresh count; usage
      // tracking must never block plugin activation.
    }
  }

  const write = () => {
    if (file === null) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const payload = {
        version: VERSION,
        startedAt,
        updatedAt: Date.now(),
        total,
        models: Object.fromEntries(models),
        sessions: [...sessionIds],
      }
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      fs.renameSync(tmp, file)
      lastError = null
    } catch (error) {
      // Persistence is best effort; in-memory totals stay authoritative. The
      // reason is retained so a caller can report degraded persistence instead
      // of silently losing the totals at the next restart.
      lastError = error?.code ?? error?.message ?? 'write failed'
    }
  }

  const schedule = () => {
    if (file === null) return
    if (timer !== null) return
    timer = setTimeout(() => { timer = null; write() }, WRITE_DELAY_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  /**
   * Record one model call.
   * @param usage - Normalized usage buckets from the pricing module.
   * @param cost - Cost in CNY for this call.
   * @param model - Billed model id.
   * @param sessionId - Session that made the call, when known.
   */
  const record = (usage, cost, model, sessionId) => {
    total.input += usage.input
    total.output += usage.output
    total.cacheRead += usage.cacheRead
    total.cacheWrite += usage.cacheWrite
    total.calls += 1
    total.cost += cost

    const id = typeof model === 'string' && model.length > 0 ? model : 'unknown'
    const row = models.get(id) ?? emptyTotal()
    row.input += usage.input
    row.output += usage.output
    row.cacheRead += usage.cacheRead
    row.cacheWrite += usage.cacheWrite
    row.calls += 1
    row.cost += cost
    models.set(id, row)
    if (models.size > MAX_MODELS) {
      // Drop the least-used model so the file stays bounded.
      const victim = [...models.entries()].sort((a, b) => a[1].calls - b[1].calls)[0]
      if (victim !== undefined) models.delete(victim[0])
    }

    if (typeof sessionId === 'string' && sessionId.length > 0) sessionIds.add(sessionId)
    schedule()
  }

  /**
   * Read the current totals.
   * @returns Totals, per-model rows, the session count, and any persistence error.
   */
  const snapshot = () => ({
    total: { ...total },
    models: Object.fromEntries([...models.entries()].map(([id, row]) => [id, { ...row }])),
    sessions: sessionIds.size,
    ...(lastError === null ? {} : { persistError: lastError }),
  })

  /** Zero every counter and persist the empty ledger. */
  const reset = () => {
    Object.assign(total, emptyTotal())
    models.clear()
    sessionIds.clear()
    write()
  }

  /** Flush pending writes. */
  const close = () => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    write()
  }

  return { record, snapshot, reset, close, file }
}
