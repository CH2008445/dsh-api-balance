/**
 * Token counters and cost for one scope, such as one model or a whole run.
 */
export interface UsageTotal {
  /** Uncached input tokens. */
  input: number
  /** Generated tokens. */
  output: number
  /** Input tokens served from cache. */
  cacheRead: number
  /** Input tokens written to cache. */
  cacheWrite: number
  /** Number of billed model calls. */
  calls: number
  /** Cost in {@link BalancePayload.usageCurrency}. */
  cost: number
}

/**
 * Cost accumulated since this host process started.
 *
 * A plugin reload keeps the same process start, so the running cost survives it;
 * a new launch starts from zero.
 */
export interface UsageSummary {
  /** Totals for the whole run. */
  total: UsageTotal
  /** Per-model totals, keyed by billed model id. */
  models: Record<string, UsageTotal>
  /** Number of distinct sessions that made a billed call. */
  sessions: number
}

/**
 * One currency entry of an account balance.
 */
export interface BalanceInfo {
  /** ISO currency code reported by DeepSeek, for example `CNY` or `USD`. */
  currency: string
  /** Total available balance, including granted and topped-up amounts. */
  totalBalance: string
  /** Not-yet-expired granted balance. */
  grantedBalance: string
  /** Topped-up balance. */
  toppedUpBalance: string
}

/**
 * Result of one balance query, always accompanied by the run's usage summary.
 *
 * Failures carry a fixed message rather than a provider or network error, so no
 * request detail can escape into the UI. Usage is present either way, because
 * the cost of the run is knowable without the network.
 */
export type BalancePayload = (
  | {
      ok: true
      /** Whether the account can still pay for API calls. */
      isAvailable: boolean
      /** Currency of the returned amounts. */
      currency: string
      totalBalance: string
      grantedBalance: string
      toppedUpBalance: string
      /** Epoch milliseconds of this reading. */
      fetchedAt: number
    }
  | {
      ok: false
      /** Fixed, non-sensitive failure reason. */
      error: string
    }
) & {
  /** Token and cost totals accumulated since this process started. */
  usage: UsageSummary
  /** Currency of every amount under `usage`. */
  usageCurrency: string
}

/**
 * Deployment-tunable plugin options. The official endpoint and the API-key
 * handling are security invariants and are intentionally absent here.
 */
export interface Config {
  /** Lifetime of a cached balance reading in milliseconds. Defaults to 60000. */
  cacheMs?: number
  /** Exact HTTP route serving the payload. Defaults to `/api/dsh-api-balance`. */
  path?: string
  /** Persist usage totals so a plugin reload keeps this run's cost. Defaults to true. */
  persistUsage?: boolean
  /**
   * Beijing holiday dates (`YYYY-MM-DD`) billed at off-peak rates. The official
   * holiday calendar cannot be known in advance, so it is deployment input.
   */
  holidays?: string[]
  /**
   * Override or extend the built-in price table, CNY per 1M tokens. An entry
   * carries `cacheHit`, `cacheMiss`, `output`, and an optional `peak` tier.
   */
  prices?: Record<string, { cacheHit: number; cacheMiss: number; output: number; peak?: { cacheHit: number; cacheMiss: number; output: number } }>
}

/**
 * Report whether an instant is billed at peak rates.
 * @param at - Epoch milliseconds to classify.
 * @param holidays - Optional `YYYY-MM-DD` Beijing dates treated as off-peak.
 */
export declare function isPeak(at: number, holidays?: string[]): boolean

/**
 * Cost in CNY for one model call.
 * @param usage - Token counts for the call.
 * @param model - Model id from the request.
 * @param at - Epoch milliseconds of the call.
 * @param table - Price table override.
 * @param holidays - Optional Beijing holiday dates treated as off-peak.
 */
export declare function costOf(
  usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | null,
  model: string,
  at: number,
  table?: Config['prices'],
  holidays?: string[],
): number
