/**
 * DeepSeek pricing and cost arithmetic.
 *
 * Prices are CNY per 1,000,000 tokens, matching the official pricing page. Cost
 * is derived from token counts alone, so this module stays pure and testable.
 *
 * Billing rules taken from the official page:
 *  - Off-peak price is half the peak price.
 *  - Peak windows are Beijing time (UTC+8), Monday to Friday, 09:00-12:00 and
 *    14:00-18:00. Everything else, including weekends, is off-peak. Chinese
 *    public holidays are also off-peak; callers may supply those dates because
 *    the holiday calendar is not knowable in advance.
 *  - Cache writes are billed at the cache-hit rate, matching historical pricing.
 *  - Model names are billed by their active alias: `deepseek-v4-flash` and
 *    `deepseek-v4-flash-vision-exp` are served by the flash model and billed at
 *    flash prices.
 */

/** Currency of every price in this module. */
export const CURRENCY = 'CNY'

/** Beijing time offset from UTC, in hours. */
const BEIJING_OFFSET_HOURS = 8

/** Peak windows in Beijing local hours, half-open `[start, end)`. */
const PEAK_WINDOWS = [
  { start: 9, end: 12 },
  { start: 14, end: 18 },
]

/**
 * Built-in price table, CNY per 1M tokens.
 *
 * `cacheMiss` bills uncached input, `cacheHit` bills both cache reads and cache
 * writes, and `output` bills generated tokens. `peak` holds the peak-hour tier;
 * the top-level values are the off-peak tier.
 */
export const DEFAULT_PRICES = {
  'deepseek-flash': {
    cacheHit: 0.02,
    cacheMiss: 1,
    output: 4,
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
  'deepseek-v4-pro': {
    cacheHit: 0.15,
    cacheMiss: 4.5,
    output: 13.5,
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  },
}

/**
 * Retired model names still billed as the model that now serves them.
 *
 * The official page states these remain callable and are served, and billed, as
 * the flash model.
 */
export const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
}

/** Price tier applied when a model id matches nothing in the table. */
const FALLBACK_PRICES = { cacheHit: 0, cacheMiss: 0, output: 0 }

/**
 * Resolve the billable model id for an alias.
 * @param model - Model id from the request.
 * @returns The billed model id.
 */
export function resolveModelId(model) {
  const id = typeof model === 'string' ? model.trim() : ''
  return MODEL_ALIASES[id] ?? id
}

/**
 * Report whether an instant falls in a peak window, in Beijing time.
 *
 * @param at - Epoch milliseconds to classify.
 * @param holidays - Optional `YYYY-MM-DD` Beijing dates treated as off-peak.
 * @returns True when the instant is billed at peak rates.
 */
export function isPeak(at, holidays) {
  // Shift the instant into Beijing wall-clock time, then read UTC fields from
  // the shifted value so no timezone database is involved.
  const shifted = new Date(at + BEIJING_OFFSET_HOURS * 3600 * 1000)
  const day = shifted.getUTCDay() // 0 = Sunday
  if (day === 0 || day === 6) return false
  const hour = shifted.getUTCHours()
  if (!PEAK_WINDOWS.some((w) => hour >= w.start && hour < w.end)) return false
  if (Array.isArray(holidays) && holidays.length > 0) {
    const key = shifted.toISOString().slice(0, 10)
    if (holidays.includes(key)) return false
  }
  return true
}

/**
 * Look up the price tier for one model at one instant.
 *
 * @param model - Model id from the request.
 * @param at - Epoch milliseconds of the call.
 * @param table - Price table; defaults to {@link DEFAULT_PRICES}.
 * @param holidays - Optional Beijing holiday dates treated as off-peak.
 * @returns The resolved per-1M-token prices.
 */
export function priceFor(model, at, table = DEFAULT_PRICES, holidays) {
  const id = resolveModelId(model)
  const entry = table[id]
  if (entry === undefined) return FALLBACK_PRICES
  if (isPeak(at, holidays) && entry.peak !== undefined) return entry.peak
  return { cacheHit: entry.cacheHit, cacheMiss: entry.cacheMiss, output: entry.output }
}

/**
 * Cost in CNY for one model call.
 *
 * Cache writes bill at the cache-hit rate, and cache reads and writes are
 * counted as input; `inputTokens` is uncached input only, per the harness
 * `TokenUsage` contract.
 *
 * @param usage - Token counts for the call.
 * @param model - Model id from the request.
 * @param at - Epoch milliseconds of the call.
 * @param table - Price table; defaults to {@link DEFAULT_PRICES}.
 * @param holidays - Optional Beijing holiday dates treated as off-peak.
 * @returns The cost in CNY, or 0 when usage or prices are unusable.
 */
export function costOf(usage, model, at, table = DEFAULT_PRICES, holidays) {
  if (usage === null || typeof usage !== 'object') return 0
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  const uncachedInput = count(usage.inputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const output = count(usage.outputTokens)
  if (uncachedInput + cacheRead + cacheWrite + output === 0) return 0

  const price = priceFor(model, at, table, holidays)
  const perToken = 1 / 1_000_000
  return (
    uncachedInput * price.cacheMiss * perToken
    + (cacheRead + cacheWrite) * price.cacheHit * perToken
    + output * price.output * perToken
  )
}

/**
 * Normalize raw token counts into the tracked buckets.
 *
 * @param usage - Token counts from a stream usage chunk.
 * @returns Counts with absent and invalid fields read as zero.
 */
export function normalizeUsage(usage) {
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  if (usage === null || typeof usage !== 'object') {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }
  return {
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    cacheRead: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
  }
}

/**
 * Report the price table for display, with the tier in force at one instant.
 *
 * Each model carries its off-peak and peak tiers so the UI can show both and
 * mark the applicable one. The `__tier` key states which tier is current;
 * consumers must skip keys beginning with `__`.
 *
 * @param at - Epoch milliseconds the table describes.
 * @param table - Price table; defaults to {@link DEFAULT_PRICES}.
 * @param holidays - Optional Beijing holiday dates treated as off-peak.
 * @returns Per-model prices plus the current tier.
 */
export function priceTable(at, table = DEFAULT_PRICES, holidays) {
  const out = { __tier: isPeak(at, holidays) ? 'peak' : 'offPeak', __currency: CURRENCY }
  for (const [id, entry] of Object.entries(table)) {
    out[id] = {
      currency: CURRENCY,
      cacheHit: entry.cacheHit,
      cacheMiss: entry.cacheMiss,
      output: entry.output,
      offPeak: entry.offPeak ?? { cacheHit: entry.cacheHit, cacheMiss: entry.cacheMiss, output: entry.output },
      peak: entry.peak ?? { cacheHit: entry.cacheHit, cacheMiss: entry.cacheMiss, output: entry.output },
    }
  }
  return out
}

/**
 * Add one call's usage into a running total.
 *
 * @param total - Accumulated totals, mutated in place.
 * @param usage - Normalized usage from {@link normalizeUsage}.
 * @param cost - Cost in CNY for this call.
 * @returns The updated total.
 */
export function accumulate(total, usage, cost) {
  total.input += usage.input
  total.output += usage.output
  total.cacheRead += usage.cacheRead
  total.cacheWrite += usage.cacheWrite
  total.calls += 1
  total.cost += cost
  return total
}

/** A zeroed usage total. */
export function emptyTotal() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 }
}
