/**
 * Release verification for dsh-api-balance.
 *
 * Runs offline with no credentials. Every check is asserted; the process exits
 * non-zero on the first failure so it can gate a release or CI run.
 *
 * Pass --live to additionally perform one real balance query. That check needs
 * BALANCE_TEST_KEY to hold a real DeepSeek API key and is skipped otherwise.
 */

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (message) => {
  console.error('FAIL: ' + message)
  process.exit(1)
}
const ok = (message) => console.log('  ok  ' + message)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// ── 1. Manifest ──────────────────────────────────────────────────────────────

if (pkg.name !== 'dsh-api-balance') fail('package name must be dsh-api-balance')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch must point at ./cordis.patch.yml')
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be web')
if (pkg.dsh?.client?.inject !== undefined) fail('dsh.client.inject is not part of the manifest contract; declare client services in client.js')
if (pkg.exports?.['.']?.default !== './lib/index.js') fail('exports["."].default must point at lib/index.js')
if (pkg.exports?.['./client']?.default !== './lib/client.js') fail('exports["./client"].default must point at lib/client.js')
for (const file of ['lib/index.js', 'lib/client.js', 'lib/pricing.js', 'lib/usage-ledger.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'LICENSE']) {
  if (!existsSync(join(root, file))) fail('missing release file: ' + file)
}
// Every shipped language needs a README, cross-linked from each other one.
const readmes = ['README.md', 'README.zh.md', 'README.ru.md', 'README.de.md']
for (const file of readmes) {
  if (!existsSync(join(root, file))) fail('missing README: ' + file)
  if (!pkg.files.includes(file)) fail(`${file} must be listed in package.json "files"`)
  const text = readFileSync(join(root, file), 'utf8')
  for (const other of readmes) {
    if (other !== file && !text.includes(`(${other})`)) fail(`${file} must link to ${other}`)
  }
}
ok('manifest declares the bundle, the web client, and all four READMEs')

// ── 2. Loader patch ──────────────────────────────────────────────────────────

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
if (!/^-\s*insert:/mu.test(patch)) fail('cordis.patch.yml must insert a loader row')
if (!new RegExp('name:\\s*' + pkg.name, 'u').test(patch)) fail('cordis.patch.yml row must reference the package by name')
ok('cordis.patch.yml inserts one row resolved by package name')

// ── 3. Host module ───────────────────────────────────────────────────────────

const host = await import(new URL('../lib/index.js', import.meta.url).href)
const allowed = ['Config', 'apply', 'inject', 'name']
const extra = Object.keys(host).filter((key) => !allowed.includes(key))
if (extra.length > 0) fail('host module exports unexpected keys: ' + extra.join(', '))
if (host.name !== 'api-balance') fail('host plugin name must be api-balance')
if (typeof host.apply !== 'function') fail('host plugin must export apply()')
if (!Array.isArray(host.inject) || !host.inject.includes('webServer') || !host.inject.includes('credentials')) {
  fail('host plugin must inject webServer and credentials')
}
ok('host module exposes only name, apply, inject, Config')

// ── 4. Security invariants in the host source ────────────────────────────────

const hostSrc = readFileSync(join(root, 'lib/index.js'), 'utf8')
for (const [label, pattern] of [
  ['no child_process import', /from\s+['"]node:child_process['"]/u],
  ['no shell execution', /\b(execSync|execFile|spawnSync|spawn)\s*\(/u],
  ['no sandbox bypass', /danger-full-access|sandboxPolicy/u],
  ['official host pinned', /api\.deepseek\.com/u],
]) {
  const hit = pattern.test(hostSrc)
  if (label.startsWith('no ')) {
    if (hit) fail(`${label}: matched ${String(pattern)}`)
  } else if (!hit) {
    fail(`${label}: pattern absent`)
  }
}
ok('host starts no subprocess, touches no sandbox policy, and pins the official host')

// ── 5. Pricing arithmetic ────────────────────────────────────────────────────

const pricing = await import(new URL('../lib/pricing.js', import.meta.url).href)

const BEIJING = (iso) => Date.parse(iso)
// 2026-10-01 is a Thursday. 02:00Z is 10:00 Beijing (peak); 14:00Z is 22:00 Beijing (off-peak).
const PEAK = BEIJING('2026-10-01T02:00:00Z')
const OFF = BEIJING('2026-10-01T14:00:00Z')
const SATURDAY_PEAK_HOURS = BEIJING('2026-10-03T02:00:00Z')

if (pricing.isPeak(PEAK) !== true) fail('02:00Z on a Thursday must be peak (10:00 Beijing)')
if (pricing.isPeak(OFF) !== false) fail('14:00Z on a Thursday must be off-peak (22:00 Beijing)')
if (pricing.isPeak(SATURDAY_PEAK_HOURS) !== false) fail('peak hours on a Saturday must be off-peak')
if (pricing.isPeak(PEAK, ['2026-10-01']) !== false) fail('a declared holiday must be off-peak')
ok('peak windows follow Beijing weekday 09:00-12:00 and 14:00-18:00')

const near = (actual, expected, label) => {
  if (Math.abs(actual - expected) > 1e-9) fail(`${label}: expected ${expected}, got ${actual}`)
}
near(pricing.costOf({ inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-flash', OFF), 1, 'flash off-peak uncached input')
near(pricing.costOf({ inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-flash', PEAK), 2, 'flash peak uncached input')
near(pricing.costOf({ inputTokens: 0, outputTokens: 1_000_000 }, 'deepseek-v4-pro', OFF), 13.5, 'v4-pro off-peak output')
near(pricing.costOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 2_000_000 }, 'deepseek-flash', OFF), 0.04, 'flash cache read')
near(pricing.costOf({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 }, 'deepseek-flash', OFF), 0.02, 'cache write bills at the hit rate')
// A retired name is served, and billed, as flash.
near(pricing.costOf({ inputTokens: 1_000_000, outputTokens: 0 }, 'deepseek-v4-flash', OFF), 1, 'retired flash alias')
near(pricing.costOf({ inputTokens: 1_000_000, outputTokens: 0 }, 'unknown-model', OFF), 0, 'unknown model costs nothing')
near(pricing.costOf(null, 'deepseek-flash', OFF), 0, 'absent usage costs nothing')
ok('official CNY prices, cache tiers, aliases, and unknown models bill correctly')

const buckets = pricing.normalizeUsage({ inputTokens: 10, outputTokens: -5, cacheReadTokens: 2.7, cacheWriteTokens: undefined })
if (buckets.input !== 10 || buckets.output !== 0 || buckets.cacheRead !== 2 || buckets.cacheWrite !== 0) {
  fail('normalizeUsage must floor counts and read invalid values as zero: ' + JSON.stringify(buckets))
}
ok('usage normalization floors counts and zeroes invalid values')

// ── 6. Usage ledger ──────────────────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'dsh-balance-'))
try {
  const startedAt = 1_700_000_000_000
  const first = pricing.emptyTotal()
  pricing.accumulate(first, { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 }, 0.5)

  let ledger = (await import(new URL('../lib/usage-ledger.js', import.meta.url).href))
    .openLedger(dir, startedAt)
  ledger.record({ input: 100, output: 20, cacheRead: 5, cacheWrite: 0 }, 0.5, 'deepseek-flash', 'session-a')
  ledger.record({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, 0.25, 'deepseek-v4-pro', 'session-b')
  ledger.close()

  if (!existsSync(join(dir, 'storages', 'api-balance', 'usage.json'))) fail('ledger must persist to storages/api-balance/usage.json')

  // Same process start: totals are restored, so a plugin reload keeps the cost.
  ledger = (await import(new URL('../lib/usage-ledger.js', import.meta.url).href)).openLedger(dir, startedAt)
  let snap = ledger.snapshot()
  if (snap.total.calls !== 2) fail(`restored ledger must hold 2 calls, got ${snap.total.calls}`)
  if (Math.abs(snap.total.cost - 0.75) > 1e-9) fail(`restored cost must be 0.75, got ${snap.total.cost}`)
  if (snap.total.input !== 101 || snap.total.output !== 22 || snap.total.cacheRead !== 5) {
    fail('restored token buckets are wrong: ' + JSON.stringify(snap.total))
  }
  if (snap.sessions !== 2) fail(`restored ledger must hold 2 sessions, got ${snap.sessions}`)
  if (Object.keys(snap.models).length !== 2) fail('restored ledger must hold 2 model rows')
  ledger.close()

  // A different process start must NOT inherit the previous run's cost.
  ledger = (await import(new URL('../lib/usage-ledger.js', import.meta.url).href)).openLedger(dir, startedAt + 1)
  snap = ledger.snapshot()
  if (snap.total.calls !== 0 || snap.total.cost !== 0) fail('a new run must start from zero usage')
  ledger.close()
  ok('ledger persists across reloads and starts fresh on a new run')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── 7. Route handler behaviour ───────────────────────────────────────────────

// The default is a fake key so the leak assertion is meaningful. `--live` needs
// a real key, supplied out of band through BALANCE_TEST_KEY, because a mock that
// always returns a fake value would send that fake value to the real endpoint.
const LIVE = process.argv.includes('--live')
const SECRET = LIVE ? process.env.BALANCE_TEST_KEY : 'sk-test-key-that-must-never-be-returned'
if (LIVE && (SECRET === undefined || SECRET.length === 0)) {
  fail('--live requires BALANCE_TEST_KEY to hold a real DeepSeek API key')
}
let handler = null
let streamHandler = null
let injectCalls = 0
const services = {
  webServer: { register: (route) => { handler = route.handler; return () => {} } },
  credentials: { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: SECRET, source: 'test' } : undefined) },
  settings: { get: () => ({ apiKeyEnv: 'DEEPSEEK_API_KEY' }) },
}
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  on: (event, listen) => { if (event === 'llm/stream') streamHandler = listen; return () => {} },
  get: (service) => services[service],
  // The plugin defers its route until the web server is published, so the route
  // must NOT be registered while the service is still missing. This stand-in
  // starts with the service absent and publishes it on demand, which reproduces
  // a fresh boot where ctx.get('webServer') is undefined during activation.
  inject: (names, callback) => {
    injectCalls += 1
    const scope = {
      get: (service) => services[service],
      effect: (fn) => { fn(); return () => {} },
    }
    callback(scope)
    return () => {}
  },
}
// Keep the ledger out of the developer's real DSH home during checks.
host.apply(ctx, { cacheMs: 0, path: '/api/dsh-api-balance', persistUsage: false })
if (injectCalls !== 1) fail('apply() must defer the route through ctx.inject')
if (typeof handler !== 'function') fail('apply() must register a route handler')
if (typeof streamHandler !== 'function') fail('apply() must listen to llm/stream')

// The route must be deferred through ctx.inject, which Cordis gates on service
// readiness. An earlier revision read the service eagerly and returned silently
// when it was missing, which left the UI failing with no diagnostic at all.
{
  let lateStream = null
  let bareInject = 0
  let bareThrow = null
  const bare = {
    effect: (fn) => { fn(); return () => {} },
    on: (event, listen) => { if (event === 'llm/stream') lateStream = listen; return () => {} },
    get: () => undefined,
    inject: (names, callback) => {
      bareInject += 1
      try {
        callback({ get: () => undefined, effect: (fn) => { fn(); return () => {} } })
      } catch (error) {
        bareThrow = error
      }
      return () => {}
    },
  }
  host.apply(bare, { persistUsage: false })
  if (bareInject !== 1) fail('the route must be deferred through ctx.inject')
  if (typeof lateStream !== 'function') fail('usage accounting must install even without a web server')
  // A missing service must surface rather than be swallowed into an absent route.
  if (bareThrow === null || !/webServer/u.test(String(bareThrow.message))) {
    fail('an unavailable web server must raise an explicit error, not be ignored')
  }
}
ok('route registration defers to the web server while usage accounting installs immediately')

const call = async (headers, url = '/api/dsh-api-balance') => {
  let status = 0
  let body = ''
  await handler(
    { headers, url },
    { writeHead: (code) => { status = code }, end: (text) => { body = text } },
  )
  return { status, body }
}

const forbidden = await call({ origin: 'http://127.0.0.1:19387' })
if (forbidden.status !== 403) fail('a request without the custom header must be rejected with 403')
ok('route rejects requests missing the x-dsh-balance header')

const crossSite = await call({ 'x-dsh-balance': '1', origin: 'https://evil.example.com' })
if (crossSite.status !== 403) fail('a cross-site origin must be rejected with 403')
ok('route rejects cross-site origins')

const rejected = JSON.parse(forbidden.body)
if (rejected.ok !== false) fail('the rejection body must be a failure payload')
ok('rejection body carries no data')

// A same-origin call must never echo the key, whatever the upstream outcome.
const served = await call({ 'x-dsh-balance': '1', origin: 'http://127.0.0.1:19387' })
if (served.status !== 200) fail('a same-origin request must be answered with 200, got ' + served.status)
if (served.body.includes(SECRET)) fail('the response body leaked the API key')
ok('route answers same-origin requests without ever echoing the key')

// ── 8. Stream accounting ─────────────────────────────────────────────────────

const usagePayload = JSON.parse(served.body)
if (usagePayload.usage === undefined || typeof usagePayload.usage !== 'object') {
  fail('the route payload must carry a usage summary')
}
if (usagePayload.usage.total.calls !== 0) fail('a fresh run must report zero calls')
if (usagePayload.usageCurrency !== 'CNY') fail('usage must be reported in CNY')

// The price table travels with the payload so the UI can show the rates behind
// the cost without a second request.
const table = usagePayload.prices
if (table === undefined || typeof table !== 'object') fail('the route payload must carry a price table')
if (table.__tier !== 'peak' && table.__tier !== 'offPeak') fail('the price table must state the tier in force')
if (table.__currency !== 'CNY') fail('the price table must state its currency')
const flash = table['deepseek-flash']
if (flash === undefined) fail('the price table must include deepseek-flash')
if (flash.peak.cacheMiss !== 2 || flash.offPeak.cacheMiss !== 1) {
  fail('the price table must carry both tiers, got: ' + JSON.stringify(flash))
}
if (flash.cacheHit !== 0.02) fail('the price table must carry the cache-hit rate')
// Off-peak must be exactly half of peak, per the official pricing rule.
if (flash.peak.cacheHit !== flash.offPeak.cacheHit * 2) fail('the peak tier must be twice the off-peak tier')
if (served.body.includes(SECRET)) fail('the price table response leaked the API key')
ok('route payload carries the price table with both tiers and the tier in force')

// Drive one model call through the stream hook the plugin registered.
const chunks = await (async () => {
  const seen = []
  const stream = streamHandler(
    { provider: 'deepseek-official', model: 'deepseek-flash', sessionId: 'session-live' },
    () => (async function* () {
      yield { type: 'text', text: 'hi' }
      yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0 } }
    })(),
  )
  for await (const chunk of stream) seen.push(chunk)
  return seen
})()
if (chunks.length !== 2) fail(`the stream hook must pass every chunk through, saw ${chunks.length}`)
ok('stream hook forwards every chunk unchanged')

const afterCallRaw = await call({ 'x-dsh-balance': '1', origin: 'http://127.0.0.1:19387' })
if (afterCallRaw.body.includes(SECRET)) fail('the usage response leaked the API key')
const afterCall = JSON.parse(afterCallRaw.body)
if (afterCall.usage.total.calls !== 1) fail(`one model call must be counted, got ${afterCall.usage.total.calls}`)
if (afterCall.usage.total.input !== 1_000_000 || afterCall.usage.total.output !== 1_000_000) {
  fail('token buckets were not accumulated: ' + JSON.stringify(afterCall.usage.total))
}
if (afterCall.usage.sessions !== 1) fail('the session must be counted once')
// 1M uncached input plus 1M output on flash: 1 + 4 off-peak, 2 + 8 peak.
const expectedCosts = [5, 10]
if (!expectedCosts.some((c) => Math.abs(afterCall.usage.total.cost - c) < 1e-9)) {
  fail(`cost must be 5 (off-peak) or 10 (peak) CNY, got ${afterCall.usage.total.cost}`)
}
if (afterCall.usage.models['deepseek-flash'] === undefined) fail('the per-model row must be recorded')
ok('one model call is billed, bucketed per model, and reported without the key')

// A stream that yields no usage must not create a phantom call.
const before = afterCall.usage.total.calls
await (async () => {
  const stream = streamHandler(
    { model: 'deepseek-flash' },
    () => (async function* () { yield { type: 'text', text: 'no usage' } })(),
  )
  for await (const chunk of stream) void chunk
})()
const afterEmpty = JSON.parse((await call({ 'x-dsh-balance': '1', origin: 'http://127.0.0.1:19387' })).body)
if (afterEmpty.usage.total.calls !== before) fail('a stream without a usage chunk must not be billed')
ok('a stream without a usage chunk is not billed')

// ── 9. Client bundle contract ────────────────────────────────────────────────

const clientSrc = readFileSync(join(root, 'lib/client.js'), 'utf8')
let captured = null
const fakeWindow = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
}
new Function('window', 'setInterval', 'clearInterval', 'document', clientSrc)(
  fakeWindow, () => 0, () => {},
  { hidden: false, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
)
if (captured === null) fail('client bundle must call window.__ModuleLoader__.load')

// Regression guard: a module id that differs from the package name fails the
// whole web boot entry with "duplicate factory registration".
if (captured.id !== pkg.name) {
  fail(`client bundle id "${captured.id}" must equal the package name "${pkg.name}"`)
}
ok('client bundle id equals the package name (boot-entry regression guard)')

const clientExports = captured.factory((request) => {
  if (request === 'react') return React
  throw new Error('unexpected client require: ' + request)
})
if (typeof clientExports.apply !== 'function') fail('client bundle must export apply()')
if (!Array.isArray(clientExports.inject) || !clientExports.inject.includes('slots')) {
  fail('client plugin must inject the slots service')
}
ok('client bundle exports apply() and injects slots')

const registered = []
clientExports.apply({
  slots: {
    inject: (name, callback) => callback(),
    register: (options, Component) => { registered.push({ options, Component }); return () => {} },
  },
})
const slot = registered[0]?.options
if (slot?.name !== 'sidebar.footer.action') fail('client must register into sidebar.footer.action')
if (slot?.id !== pkg.name) fail('client slot entry id must equal the package name')

// The row loads through fetch and stores the result in React state, so drive it
// with a stub fetch and a stateful hook stand-in that renders the loaded value.
const PRICES = {
  __tier: 'offPeak',
  __currency: 'CNY',
  'deepseek-flash': {
    currency: 'CNY',
    cacheHit: 0.02,
    cacheMiss: 1,
    output: 4,
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
  'deepseek-v4-pro': {
    currency: 'CNY',
    cacheHit: 0.15,
    cacheMiss: 4.5,
    output: 13.5,
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  },
}
const payload = {
  ok: true,
  isAvailable: true,
  currency: 'CNY',
  totalBalance: '9.97',
  grantedBalance: '4.09',
  toppedUpBalance: '5.88',
  usageCurrency: 'CNY',
  usage: {
    total: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 0, calls: 3, cost: 0.1234 },
    models: {},
    sessions: 1,
  },
  prices: PRICES,
}

/**
 * Render the row once against a stub payload and document language.
 *
 * The component loads through fetch and stores the result in React state, so
 * this supplies a stub fetch plus a stateful hook stand-in and performs the
 * second render that sees the loaded value.
 *
 * @param data - Payload the stub fetch resolves with.
 * @param lang - Value of `document.documentElement.lang`.
 * @returns The rendered element and its flattened text.
 */
const renderRow = async (data, lang) => {
  const realFetch = globalThis.fetch
  const effects = []
  const cells = []
  let hooks = 0
  let capturedClient = null
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => data })
    const StubReact = {
      createElement: (type, props, ...children) => ({ type, props, children: children.flat() }),
      useState: (init) => {
        const index = hooks++
        if (cells[index] === undefined) cells[index] = typeof init === 'function' ? init() : init
        return [cells[index], (next) => { cells[index] = typeof next === 'function' ? next(cells[index]) : next }]
      },
      useCallback: (fn) => fn,
      useEffect: (fn) => { effects.push(fn) },
    }
    const documentStub = {
      hidden: false,
      visibilityState: 'visible',
      documentElement: { lang },
      addEventListener() {},
      removeEventListener() {},
    }
    new Function('window', 'setInterval', 'clearInterval', 'document', 'navigator', 'MutationObserver', clientSrc)(
      { __ModuleLoader__: { load: (entry) => { capturedClient = entry } } },
      () => 0, () => {}, documentStub, { language: lang }, undefined,
    )
    const clientApi = capturedClient.factory((request) => {
      if (request === 'react') return StubReact
      throw new Error('unexpected client require: ' + request)
    })
    const components = []
    clientApi.apply({
      slots: {
        inject: (name, callback) => callback(),
        register: (options, Component) => { components.push(Component); return () => {} },
      },
    })
    components[0]({ wide: true })
    for (const effect of effects) effect()
    await new Promise((resolve) => setTimeout(resolve, 0))
    hooks = 0
    const wide = components[0]({ wide: true })
    hooks = 0
    const narrow = components[0]({ wide: false })
    return {
      element: wide,
      title: String(wide.props.title),
      text: wide.children.join(''),
      narrowText: narrow.children.join(''),
    }
  } finally {
    globalThis.fetch = realFetch
  }
}

const english = await renderRow(payload, 'en')
if (english.element.type !== 'button') fail('the row must render a button')
if (!english.title.includes('\u00a59.97')) {
  fail('the tooltip must report the balance, got: ' + JSON.stringify(english.title))
}
if (!english.title.includes('This run')) fail('the tooltip must report this run cost')
if (!english.title.includes('\u00a50.12')) fail('the tooltip must report the run cost amount')
if (!english.title.includes('Tokens in')) fail('the tooltip must break down token buckets')
// Both figures carry a label on the row itself, so neither is ambiguous.
if (!english.text.includes('Balance \u00a59.97')) {
  fail('the row must label the balance, got: ' + JSON.stringify(english.text))
}
if (!english.text.includes('Cost \u00a50.12')) {
  fail('the row must label the cost, got: ' + JSON.stringify(english.text))
}
if (!english.narrowText.includes('9.97') || !english.narrowText.includes('0.12') || english.narrowText.includes('Balance')) {
  fail('the collapsed rail must drop the labels, got: ' + JSON.stringify(english.narrowText))
}
ok('the row shows the labelled balance and cost, and the rail drops the labels')

// ── 9b. Price table in the tooltip ───────────────────────────────────────────

for (const needle of ['Prices, per 1M tokens', 'deepseek-flash', 'deepseek-v4-pro', 'cache hit', '0.0200 / \u00a51.00 / \u00a54.00', '0.1500 / \u00a54.50 / \u00a513.50']) {
  if (!english.title.includes(needle)) {
    fail(`the tooltip must show the price table entry ${JSON.stringify(needle)}, got: ` + JSON.stringify(english.title))
  }
}
if (!english.title.includes('now: off-peak')) fail('the tooltip must mark the tier in force')
if (!english.title.includes('Beijing time')) fail('the tooltip must explain when peak applies')
// Both tiers must be listed, so the peak multiplier is visible.
if (!english.title.includes('\u00a50.0400 / \u00a52.00 / \u00a58.00')) {
  fail('the tooltip must list peak rates too, got: ' + JSON.stringify(english.title))
}
// A rate keeps at least two decimals, and a sub-cent rate keeps four, so
// distinct rates never collapse onto the same string.
if (!english.title.includes('\u00a50.3000')) fail('a sub-unit rate must keep four decimals')
if (!english.title.includes('\u00a527.00')) fail('a unit-or-above rate must keep two decimals')
ok('the tooltip lists per-1M-token prices for both tiers and marks the current one')

// The price table leads the tooltip, so the rates are read before the figures
// they produced.
{
  const priceAt = english.title.indexOf('Prices, per 1M tokens')
  const balanceAt = english.title.indexOf('Balance \u00a59.97')
  const costAt = english.title.indexOf('This run')
  if (priceAt < 0) fail('the tooltip must contain the price table')
  if (balanceAt < 0) fail('the tooltip must contain the balance line')
  if (costAt < 0) fail('the tooltip must contain the run cost line')
  if (!(priceAt < balanceAt && balanceAt < costAt)) {
    fail(`the tooltip order must be prices, balance, cost; got offsets ${priceAt}/${balanceAt}/${costAt}`)
  }
  // The first line of the tooltip is the price heading, not the balance.
  if (english.title.split('\n')[0].indexOf('Prices') < 0) {
    fail('the price table must be the first tooltip section, got: ' + JSON.stringify(english.title.split('\n')[0]))
  }
}
ok('the price table leads the tooltip, ahead of the balance and the cost')

// ── 9c. Localization ─────────────────────────────────────────────────────────

const expectations = [
  ['zh', ['\u4f59\u989d \u00a59.97', '\u8d39\u7528 \u00a50.12'], '\u4ef7\u683c\uff08\u6bcf\u767e\u4e07 tokens\uff09'],
  ['zh-CN', ['\u4f59\u989d \u00a59.97'], '\u7a7a\u95f2\u65f6\u6bb5'],
  ['ru', ['\u0411\u0430\u043b\u0430\u043d\u0441 \u00a59.97', '\u0420\u0430\u0441\u0445\u043e\u0434 \u00a50.12'], '\u0426\u0435\u043d\u044b \u0437\u0430 1 \u043c\u043b\u043d \u0442\u043e\u043a\u0435\u043d\u043e\u0432'],
  ['de', ['Guthaben \u00a59.97', 'Kosten \u00a50.12'], 'Preise pro 1 Mio. Token'],
  ['de-AT', ['Guthaben \u00a59.97'], 'Nebenzeit'],
  ['ja', ['Balance \u00a59.97'], 'Prices, per 1M tokens'],
]
for (const [lang, needles, priceNeedle] of expectations) {
  const view = await renderRow(payload, lang)
  for (const needle of needles) {
    if (!view.text.includes(needle)) {
      fail(`language ${lang} must render ${JSON.stringify(needle)}, got: ` + JSON.stringify(view.text))
    }
  }
  if (!view.title.includes(priceNeedle)) {
    fail(`language ${lang} must translate the price heading, got: ` + JSON.stringify(view.title.split('\n').slice(0, 3)))
  }
}
ok('copy renders in Chinese, Russian, and German, with an English fallback')

// Every language must define every key, so a missing translation cannot surface.
// The dictionaries are module-private, so they are read from source. Brace
// matching is used rather than a regex, because a language id also occurs inside
// value text and key names.
const extractBlock = (source, startIndex) => {
  let depth = 0
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(startIndex, i + 1)
    }
  }
  return null
}
const keySets = {}
for (const lang of ['en', 'zh', 'ru', 'de']) {
  const marker = new RegExp(`\\b${lang}:\\s*\\{`, 'u').exec(clientSrc)
  if (marker === null) fail(`the MESSAGES table must define ${lang}`)
  const open = clientSrc.indexOf('{', marker.index)
  const block = extractBlock(clientSrc, open)
  if (block === null) fail(`the ${lang} dictionary is not brace-balanced`)
  keySets[lang] = [...block.matchAll(/(?:^|[\s{,])([A-Za-z][A-Za-z0-9]*):/gmu)].map((m) => m[1]).sort()
}
const reference = keySets.en.join(',')
if (keySets.en.length < 15) fail(`the English dictionary looks truncated (${keySets.en.length} keys)`)
for (const lang of ['zh', 'ru', 'de']) {
  if (keySets[lang].join(',') !== reference) {
    const missing = keySets.en.filter((k) => !keySets[lang].includes(k))
    const extra = keySets[lang].filter((k) => !keySets.en.includes(k))
    fail(`the ${lang} dictionary must define exactly the English keys (missing: ${missing.join(',') || 'none'}; extra: ${extra.join(',') || 'none'})`)
  }
}
ok(`all four dictionaries define the same ${keySets.en.length} keys`)

// A host that reports no price table must still render the row.
{
  const bare = { ...payload, prices: undefined, usage: { total: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0 }, models: {}, sessions: 0 } }
  const view = await renderRow(bare, 'en')
  if (!view.text.includes('Balance \u00a59.97')) {
    fail('an unbilled run must still show the balance, got: ' + JSON.stringify(view.text))
  }
  if (!view.text.includes('Cost --')) {
    fail('an unbilled run must keep a cost placeholder, got: ' + JSON.stringify(view.text))
  }
  // No prices means no price section, and no crash.
  if (view.title.includes('Prices, per 1M tokens')) fail('a host without prices must not show a price table')
}
ok('an unbilled run keeps both labels, and a host without prices renders normally')

// ── 10. Optional live query ──────────────────────────────────────────────────

if (LIVE) {
  const live = await call({ 'x-dsh-balance': '1', origin: 'http://127.0.0.1:19387' }, '/api/dsh-api-balance?force=1')
  const payload = JSON.parse(live.body)
  if (live.body.includes(SECRET)) fail('live response leaked the API key')
  if (payload.ok !== true) fail('live query failed: ' + payload.error)
  if (typeof payload.totalBalance !== 'string') fail('live query must return totalBalance as a string')
  if (payload.usage === undefined) fail('live payload must carry usage alongside the balance')
  console.log(`  ok  live balance ${payload.currency} ${payload.totalBalance} (granted ${payload.grantedBalance}, topped up ${payload.toppedUpBalance})`)
} else {
  console.log('  --  live query skipped (pass --live with BALANCE_TEST_KEY to enable)')
}

console.log('\nall checks passed')
