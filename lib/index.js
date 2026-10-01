/**
 * dsh-api-balance — DeepSeek Harness host plugin.
 *
 * Queries the DeepSeek open-platform account balance inside the host process
 * and exposes it to the Web GUI as four non-sensitive fields.
 *
 * Security invariants (deliberately NOT configurable):
 *  1. The API key is resolved through `ctx.credentials` and never reaches a
 *     command line, a log line, an error message, a session record, or the
 *     browser.
 *  2. Requests use the in-process global `fetch`. No subprocess and no shell
 *     is started, so no sandbox policy is involved or bypassed.
 *  3. The balance endpoint is restricted to the official host. A configured
 *     `baseURL` on any other host makes the plugin refuse to send the key.
 *  4. Only the four balance fields are returned; the key is never included.
 */

/**
 * Load `@deepseek-ai/schemastery` when the DSH runtime provides it.
 *
 * The schema only supplies defaults and range validation, so a host without
 * the package still runs correctly: the fallback carries the same defaults and
 * the handler treats absent or out-of-range values defensively. Loading it
 * dynamically keeps this plugin loadable outside a DSH install, which is what
 * lets the release checks run standalone.
 *
 * @returns The Schema factory, or a compatible minimal implementation.
 */
async function loadSchema() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    return mod.default
  } catch {
    // Absent schemastery: return a stand-in exposing the same builder calls.
    // Every constraint returns the same node, and `default` is recorded so the
    // handler still sees the documented defaults.
    const chain = (fallbackValue) => {
      const node = {
        value: fallbackValue,
        min: () => node,
        max: () => node,
        default: (value) => { node.value = value; return node },
      }
      return node
    }
    return {
      number: () => chain(DEFAULT_CACHE_MS),
      string: () => chain('/api/dsh-api-balance'),
      object: (fields) => ({ fields }),
    }
  }
}

const Schema = await loadSchema()

/** Official balance endpoint. Protocol constant, not a deployment choice. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** The only host the API key may be sent to. Security invariant. */
const OFFICIAL_HOST = 'api.deepseek.com'

/** Default lifetime of a cached balance result, in milliseconds. */
const DEFAULT_CACHE_MS = 60_000

/** Upper bound for the cache lifetime, so a misconfiguration cannot pin a stale balance for long. */
const MAX_CACHE_MS = 3_600_000

/** Request timeout for the balance call, in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000

export const name = 'api-balance'

/** Host services this plugin needs. */
export const inject = ['webServer', 'credentials']

/** Deployment-tunable options. Security invariants stay out of this schema. */
export const Config = Schema.object({
  cacheMs: Schema.number().min(0).max(MAX_CACHE_MS).default(DEFAULT_CACHE_MS),
  path: Schema.string().default('/api/dsh-api-balance'),
})

/**
 * Resolve the API-key reference and the balance endpoint for this deployment.
 *
 * The key reference and the endpoint root come from the same `llm-deepseek`
 * settings section the model requests use, so this plugin authenticates as the
 * same principal. A `baseURL` on a non-official host yields a null endpoint,
 * which the caller must treat as "refuse to send the key".
 *
 * @param ctx - Host plugin context.
 * @returns The credential reference name and the validated endpoint, or a null endpoint.
 */
function resolveTarget(ctx) {
  const settings = ctx.get('settings')
  let baseURL = ''
  let apiKeyEnv = 'DEEPSEEK_API_KEY'
  if (settings !== undefined && typeof settings.get === 'function') {
    const section = settings.get('llm-deepseek')
    if (section !== undefined && section !== null) {
      if (typeof section.baseURL === 'string') baseURL = section.baseURL
      if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0) {
        apiKeyEnv = section.apiKeyEnv
      }
    }
  }
  if (baseURL.trim().length === 0 && typeof process.env.DEEPSEEK_BASE_URL === 'string') {
    baseURL = process.env.DEEPSEEK_BASE_URL
  }
  if (baseURL.trim().length === 0) return { apiKeyEnv, endpoint: BALANCE_URL }
  let host
  try {
    host = new URL(baseURL.trim()).host.toLowerCase()
  } catch {
    // An unparseable baseURL cannot be proven official, so the key stays unsent.
    return { apiKeyEnv, endpoint: null }
  }
  return { apiKeyEnv, endpoint: host === OFFICIAL_HOST ? BALANCE_URL : null }
}

/**
 * Resolve the API key, preferring the credential store over the launch environment.
 *
 * @param ctx - Host plugin context.
 * @param ref - Credential reference name.
 * @returns The key, or null when unconfigured.
 */
async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
        return hit.value
      }
    } catch {
      // An unavailable credential service falls back to the environment; the
      // failure detail is not surfaced because it may quote the stored value.
    }
  }
  const fromEnv = process.env[ref]
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

/**
 * Query the balance once.
 *
 * @param ctx - Host plugin context.
 * @returns A payload for the UI, or `{ ok: false, error }` with a fixed message.
 */
async function queryBalance(ctx) {
  const target = resolveTarget(ctx)
  if (target.endpoint === null) {
    return {
      ok: false,
      error: 'baseURL is not the official api.deepseek.com host; refusing to send the API key',
    }
  }
  const apiKey = await resolveApiKey(ctx, target.apiKeyEnv)
  if (apiKey === null) {
    return { ok: false, error: `API key is not configured (credential ${target.apiKeyEnv})` }
  }
  let response
  try {
    response = await fetch(target.endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    // The underlying error is withheld: it can echo request headers.
    return { ok: false, error: 'balance request failed or timed out' }
  }
  if (!response.ok) {
    return { ok: false, error: `balance endpoint returned HTTP ${String(response.status)}` }
  }
  let data
  try {
    data = await response.json()
  } catch {
    return { ok: false, error: 'balance response was not valid JSON' }
  }
  const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : undefined
  if (info === undefined) {
    return { ok: false, error: 'balance response carried no balance_infos' }
  }
  return {
    ok: true,
    isAvailable: data.is_available === true,
    currency: typeof info.currency === 'string' ? info.currency : '',
    totalBalance: String(info.total_balance ?? ''),
    grantedBalance: String(info.granted_balance ?? ''),
    toppedUpBalance: String(info.topped_up_balance ?? ''),
    fetchedAt: Date.now(),
  }
}

/**
 * Register the balance route with its cache.
 *
 * @param ctx - Host plugin context.
 * @param config - Validated plugin configuration.
 */
export function apply(ctx, config) {
  const routePath = config?.path ?? '/api/dsh-api-balance'
  const ttl = config?.cacheMs ?? DEFAULT_CACHE_MS
  // `inject` guarantees the service before apply runs; the guard keeps a host
  // that omits it from throwing during activation.
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  let cached = null
  let cachedAt = 0

  const read = async (force) => {
    const now = Date.now()
    if (!force && cached !== null && now - cachedAt < ttl) return cached
    const payload = await queryBalance(ctx)
    // Only successful reads are cached, so one network failure cannot freeze
    // an error into the UI for a whole cache window.
    if (payload.ok) {
      cached = payload
      cachedAt = now
    }
    return payload
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: routePath,
    handler: async (req, res) => {
      // A cross-site page cannot set this header without a preflight, which is
      // not answered here, so the route is readable only from the GUI origin.
      const requested = req.headers['x-dsh-balance'] === '1'
      const origin = req.headers.origin
      const sameOrigin = origin === undefined
        || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(origin)
      if (!requested || !sameOrigin) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
        res.end('{"ok":false,"error":"forbidden"}')
        return
      }
      let payload
      try {
        payload = await read(typeof req.url === 'string' && req.url.includes('force=1'))
      } catch {
        payload = { ok: false, error: 'balance query failed' }
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(payload))
    },
  }), 'api-balance: route')
}
