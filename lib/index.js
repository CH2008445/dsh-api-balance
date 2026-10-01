/**
 * dsh-api-balance — DeepSeek Harness host plugin.
 *
 * Reports two things about the DeepSeek account to the Web GUI:
 *  - the account balance, queried read-only from the official endpoint;
 *  - the API usage cost accumulated since this process started, derived from
 *    the usage chunks the harness emits for every model call.
 *
 * Security invariants (deliberately NOT configurable):
 *  1. The API key is resolved through `ctx.credentials` and never reaches a
 *     command line, a log line, an error message, a session record, or the
 *     browser.
 *  2. Requests use the in-process global `fetch`. No subprocess and no shell
 *     is started, so no sandbox policy is involved or bypassed.
 *  3. The balance endpoint is restricted to the official host. A configured
 *     `baseURL` on any other host makes the plugin refuse to send the key.
 *  4. Only non-sensitive fields are returned; the key is never included.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { costOf, normalizeUsage, DEFAULT_PRICES, CURRENCY } from './pricing.js'
import { openLedger } from './usage-ledger.js'

/**
 * Default lifetime of a cached balance result, in milliseconds.
 *
 * Declared before the schema because the fallback chain below reads it while
 * building its default.
 */
const DEFAULT_CACHE_MS = 60_000

/**
 * Load `@deepseek-ai/schemastery` when the DSH runtime provides it.
 *
 * Cordis validates config through the Standard Schema interface
 * (`Config["~standard"].validate`). A stand-in schema cannot satisfy that
 * interface, and a `Config` export that fails validation aborts plugin
 * activation before `apply` runs — which silently removes every contribution
 * the plugin makes. So this returns undefined rather than a fake schema when
 * the real package is unavailable; Cordis then skips validation and passes the
 * raw config, and the handler applies its own defaults.
 *
 * @returns The Schema factory, or undefined when it is not usable.
 */
async function loadSchema() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    const Schema = mod.default
    // Only accept a factory whose product really implements Standard Schema.
    const probe = Schema?.object?.({})
    return probe !== undefined && probe !== null && probe['~standard'] !== undefined ? Schema : undefined
  } catch {
    // The package is absent, or it is a different implementation than expected.
    return undefined
  }
}

const Schema = await loadSchema()

/** Official balance endpoint. Protocol constant, not a deployment choice. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** The only host the API key may be sent to. Security invariant. */
const OFFICIAL_HOST = 'api.deepseek.com'

/** Upper bound for the cache lifetime, so a misconfiguration cannot pin a stale balance for long. */
const MAX_CACHE_MS = 3_600_000

/** Request timeout for the balance call, in milliseconds. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Epoch milliseconds this host process loaded the plugin.
 *
 * Usage totals are keyed by this value, so a reload of the same process keeps
 * its running cost while a genuinely new launch starts from zero.
 */
const STARTED_AT = Date.now()

export const name = 'api-balance'

/** Host services this plugin needs. */
export const inject = ['webServer', 'credentials']

/**
 * Deployment-tunable options, or undefined when no usable schema is available.
 *
 * Cordis treats a present `Config` as a promise that the value validates
 * through Standard Schema, so exporting an unusable one is worse than exporting
 * none: it aborts activation. Security invariants stay out of this schema.
 */
export const Config = Schema === undefined
  ? undefined
  : Schema.object({
    cacheMs: Schema.number().min(0).max(MAX_CACHE_MS).default(DEFAULT_CACHE_MS),
    path: Schema.string().default('/api/dsh-api-balance'),
    /** Persist usage totals so a plugin reload keeps this run's cost. */
    persistUsage: Schema.boolean().default(true),
    /**
     * Beijing holiday dates (`YYYY-MM-DD`) billed at off-peak rates. The official
     * calendar is not knowable in advance, so it is deployment input.
     */
    holidays: Schema.array(Schema.string()).default([]),
    /** Override or extend the built-in price table (CNY per 1M tokens). */
    prices: Schema.any().default(undefined),
  })

/**
 * Append one line to the plugin's activation log.
 *
 * The log exists because activation failure is otherwise invisible: a plugin
 * whose `apply` never runs still renders its UI and answers nothing, with no
 * error anywhere. Recording the activation steps makes that distinguishable
 * from a working plugin. The directory defaults to a per-user temporary
 * location so an installed package never writes inside `node_modules`; set
 * `DSH_BALANCE_DIAG` to redirect it. Only service names, resolution outcomes,
 * and status codes are written — never the key or any other secret.
 *
 * @param line - Single diagnostic line.
 */
function diag(line) {
  let dir = process.env.DSH_BALANCE_DIAG
  if (typeof dir !== 'string' || dir.length === 0) {
    dir = path.join(os.tmpdir(), 'dsh-api-balance')
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'plugin.log'), new Date().toISOString() + ' ' + line + '\n', 'utf8')
  } catch {
    // Diagnostics must never affect plugin behavior.
  }
}

/**
 * Resolve the API-key reference and the balance endpoint for this deployment.
 *
 * The key reference and the endpoint root come from the same `llm-deepseek`
 * settings section the model requests use, so this plugin authenticates as the
 * same principal. A `baseURL` on a non-official host yields a null endpoint,
 * which the caller must treat as "refuse to send the key".
 *
 * @param ctx - Host plugin context.
 * @param trace - Optional collector receiving resolution facts for diagnostics.
 * @returns The credential reference name and the validated endpoint, or a null endpoint.
 */function resolveTarget(ctx, trace) {
  const settings = ctx.get('settings')
  let baseURL = ''
  let apiKeyEnv = 'DEEPSEEK_API_KEY'
  trace?.('settings service: ' + (settings === undefined ? 'absent' : typeof settings.get))
  if (settings !== undefined && typeof settings.get === 'function') {
    let section
    try {
      section = settings.get('llm-deepseek')
    } catch (error) {
      trace?.('settings.get threw: ' + (error?.message ?? String(error)))
    }
    trace?.('llm-deepseek section: ' + (section === undefined ? 'undefined' : JSON.stringify(section)))
    if (section !== undefined && section !== null) {
      if (typeof section.baseURL === 'string') baseURL = section.baseURL
      if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0) {
        apiKeyEnv = section.apiKeyEnv
      }
    }
  }
  if (baseURL.trim().length === 0 && typeof process.env.DEEPSEEK_BASE_URL === 'string') {
    baseURL = process.env.DEEPSEEK_BASE_URL
    trace?.('baseURL from env: ' + baseURL)
  }
  trace?.('apiKeyEnv: ' + apiKeyEnv + ' | baseURL: ' + JSON.stringify(baseURL))
  if (baseURL.trim().length === 0) return { apiKeyEnv, endpoint: BALANCE_URL, trace }
  let host
  try {
    host = new URL(baseURL.trim()).host.toLowerCase()
  } catch {
    // An unparseable baseURL cannot be proven official, so the key stays unsent.
    trace?.('baseURL unparseable -> endpoint refused')
    return { apiKeyEnv, endpoint: null, trace }
  }
  return { apiKeyEnv, endpoint: host === OFFICIAL_HOST ? BALANCE_URL : null, trace }
}

/**
 * Resolve the API key, preferring the credential store over the launch environment.
 *
 * @param ctx - Host plugin context.
 * @param ref - Credential reference name.
 * @param trace - Optional collector receiving resolution facts.
 * @returns The key, or null when unconfigured.
 */
async function resolveApiKey(ctx, ref, trace) {
  const credentials = ctx.get('credentials')
  trace?.('credentials service: ' + (credentials === undefined ? 'absent' : typeof credentials.resolve))
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(ref)
      trace?.('credentials.resolve(' + ref + '): ' + (hit === undefined
        ? 'undefined'
        : 'value length ' + String(hit.value ?? '').length + ', source ' + String(hit.source)))
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) {
        return hit.value
      }
    } catch (error) {
      // The credential failure is reported by kind only: the thrown value may
      // quote the stored secret.
      trace?.('credentials.resolve threw: ' + (error?.code ?? error?.name ?? 'error'))
    }
  }
  const fromEnv = process.env[ref]
  trace?.('env ' + ref + ': ' + (typeof fromEnv === 'string' && fromEnv.length > 0 ? 'present' : 'absent'))
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : null
}

/**
 * Query the balance once.
 *
 * @param ctx - Host plugin context.
 * @param trace - Optional collector receiving resolution facts.
 * @returns A payload for the UI, or `{ ok: false, error }` with a fixed message.
 */
async function queryBalance(ctx, trace) {
  const target = resolveTarget(ctx, trace)
  if (target.endpoint === null) {
    return {
      ok: false,
      error: 'baseURL is not the official api.deepseek.com host; refusing to send the API key',
    }
  }
  const apiKey = await resolveApiKey(ctx, target.apiKeyEnv, trace)
  if (apiKey === null) {
    return { ok: false, error: `API key is not configured (credential ${target.apiKeyEnv})` }
  }
  trace?.(`requesting ${target.endpoint} with key length ${apiKey.length}`)
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
  trace?.('endpoint status: ' + String(response.status))
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
 * Attach the usage summary to a balance payload.
 *
 * Kept separate so a failed balance read still reports usage: the cost of the
 * session is knowable without the network.
 *
 * @param payload - Balance payload, successful or not.
 * @param ledger - Usage ledger handle.
 * @returns The payload plus a usage summary and the billing currency.
 */
function withUsage(payload, ledger) {
  return { ...payload, usage: ledger.snapshot(), usageCurrency: CURRENCY }
}

// Module-level marker: distinguishes "the loader never imported this module"
// from "the module loaded but apply() was never invoked", which are different
// faults with different fixes.
diag('module evaluated (exports: name=' + String(name) + ', apply=' + typeof apply + ')')

/**
 * Register the usage ledger, its stream hook, and the balance route.
 *
 * The route needs the web server, which is published asynchronously. Reading it
 * with `ctx.get` during activation returns undefined on a fresh boot, so the
 * route is registered through `ctx.inject`, which defers until the service
 * exists. Usage accounting is installed immediately and needs no service.
 *
 * @param ctx - Host plugin context.
 * @param config - Validated plugin configuration.
 */
export function apply(ctx, config) {
  diag('apply() entered; config=' + JSON.stringify(config ?? null))
  const routePath = config?.path ?? '/api/dsh-api-balance'
  const ttl = config?.cacheMs ?? DEFAULT_CACHE_MS
  const holidays = Array.isArray(config?.holidays) ? config.holidays : []
  const table = config?.prices !== null && typeof config?.prices === 'object'
    ? { ...DEFAULT_PRICES, ...config.prices }
    : DEFAULT_PRICES

  const ledger = openLedger(
    config?.persistUsage === false ? null : process.env.DSH_HOME ?? os.homedir() + '/.dsh',
    STARTED_AT,
  )
  ctx.effect(() => () => ledger.close(), 'api-balance: ledger close')

  // Every model call ends with a usage chunk; billing it here keeps the cost
  // tied to the request the harness actually made, including retries.
  ctx.on('llm/stream', (options, next) => {
    const downstream = next()
    return (async function* tracked() {
      let usage = null
      for await (const chunk of downstream) {
        if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== undefined) {
          usage = chunk.usage
        }
        yield chunk
      }
      if (usage !== null) {
        try {
          const at = Date.now()
          const buckets = normalizeUsage(usage)
          ledger.record(buckets, costOf(usage, options?.model, at, table, holidays), options?.model, options?.sessionId)
        } catch {
          // Accounting must never break a model stream that already completed.
        }
      }
    })()
  })

  // `ctx.inject` registers a child plugin whose `inject` gates the callback, so
  // Cordis calls this only once `webServer` exists. The guard below therefore
  // never fires in practice; it exists so that a broken composition raises a
  // named error instead of failing silently, which is how an earlier eager
  // `ctx.get` read managed to leave the UI broken with no diagnostic.
  ctx.inject(['webServer'], (scope) => {
    diag('inject callback fired')
    const webServer = scope.get('webServer')
    diag('webServer resolved: ' + (webServer === undefined ? 'undefined' : typeof webServer.register))
    if (webServer === undefined) {
      throw new Error('api-balance: webServer is unavailable, so the balance route cannot be registered')
    }

    let cached = null
    let cachedAt = 0
    // The most recent resolution facts, returned with the payload so a failure
    // can be diagnosed from outside the process without reading host logs.
    let lastTrace = []

    const read = async (force) => {
      const now = Date.now()
      if (!force && cached !== null && now - cachedAt < ttl) return withUsage(cached, ledger)
      const trace = []
      lastTrace = trace
      const payload = await queryBalance(scope, (line) => trace.push(line))
      // Only successful reads are cached, so one network failure cannot freeze
      // an error into the UI for a whole cache window.
      if (payload.ok) {
        cached = payload
        cachedAt = now
      }
      return withUsage(payload, ledger)
    }

    scope.effect(() => webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (req, res) => {
        diag('route hit: ' + String(req.url))
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
        } catch (error) {
          // The thrown message names the failing step only; it never carries the
          // key, because the key is not part of any error this plugin raises.
          lastTrace.push('read() threw: ' + (error?.message ?? String(error)))
          payload = { ok: false, error: 'balance query failed' }
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        // `diag` carries resolution facts so a failure is diagnosable from the
        // browser console. It never contains the key, only its length.
        res.end(JSON.stringify({ ...payload, diag: lastTrace }))
      },
    }), 'api-balance: route')
  })
}