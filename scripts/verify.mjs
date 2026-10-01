/**
 * Release verification for dsh-api-balance.
 *
 * Runs offline with no credentials. Every check is asserted; the process exits
 * non-zero on the first failure so it can gate a release or CI run.
 *
 * Pass --live to additionally perform one real balance query. That check needs
 * a configured DeepSeek API key and is skipped otherwise.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
for (const file of ['lib/index.js', 'lib/client.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'LICENSE']) {
  if (!existsSync(join(root, file))) fail('missing release file: ' + file)
}
ok('manifest declares the bundle, the web client, and the expected exports')

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

// ── 5. Route handler behaviour ───────────────────────────────────────────────

// The default is a fake key so the leak assertion is meaningful. `--live` needs
// a real key, supplied out of band through BALANCE_TEST_KEY, because a mock that
// always returns a fake value would send that fake value to the real endpoint.
const LIVE = process.argv.includes('--live')
const SECRET = LIVE ? process.env.BALANCE_TEST_KEY : 'sk-test-key-that-must-never-be-returned'
if (LIVE && (SECRET === undefined || SECRET.length === 0)) {
  fail('--live requires BALANCE_TEST_KEY to hold a real DeepSeek API key')
}
let handler = null
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  get: (service) => {
    if (service === 'webServer') {
      return { register: (route) => { handler = route.handler; return () => {} } }
    }
    if (service === 'credentials') {
      return { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: SECRET, source: 'test' } : undefined) }
    }
    if (service === 'settings') {
      return { get: () => ({ apiKeyEnv: 'DEEPSEEK_API_KEY' }) }
    }
    return undefined
  },
}
host.apply(ctx, { cacheMs: 0, path: '/api/dsh-api-balance' })
if (typeof handler !== 'function') fail('apply() must register a route handler')

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

// ── 6. Client bundle contract ────────────────────────────────────────────────

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
const element = registered[0].Component({ wide: true })
if (element?.type !== 'button') fail('the balance row must render a button')
if (!String(element.props.title).includes('Balance') && !String(element.props.title).includes('balance')) {
  fail('the balance row must carry a descriptive tooltip')
}
ok('client registers a button into sidebar.footer.action and renders')

// ── 7. Optional live query ───────────────────────────────────────────────────

if (LIVE) {
  const live = await call({ 'x-dsh-balance': '1', origin: 'http://127.0.0.1:19387' }, '/api/dsh-api-balance?force=1')
  const payload = JSON.parse(live.body)
  if (live.body.includes(SECRET)) fail('live response leaked the API key')
  if (payload.ok !== true) fail('live query failed: ' + payload.error)
  if (typeof payload.totalBalance !== 'string') fail('live query must return totalBalance as a string')
  console.log(`  ok  live query returned ${payload.currency} ${payload.totalBalance} (granted ${payload.grantedBalance}, topped up ${payload.toppedUpBalance})`)
} else {
  console.log('  --  live query skipped (pass --live with BALANCE_TEST_KEY to enable)')
}

console.log('\nall checks passed')
