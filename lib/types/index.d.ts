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
 * Result of one balance query. Failures carry a fixed message rather than a
 * provider or network error, so no request detail can escape into the UI.
 */
export type BalanceResult =
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

/**
 * Deployment-tunable plugin options. The official endpoint and the API-key
 * handling are security invariants and are intentionally absent here.
 */
export interface Config {
  /** Lifetime of a cached reading in milliseconds. Defaults to 60000. */
  cacheMs?: number
  /** Exact HTTP route serving the balance JSON. Defaults to `/api/dsh-api-balance`. */
  path?: string
}
