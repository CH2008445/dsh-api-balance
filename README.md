# dsh-api-balance

**DeepSeek API account balance and run cost** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. One line in the sidebar footer shows your balance and what this run has cost so far.

Built for one purpose: showing what you are spending **without widening the blast radius of your API key**. The whole plugin is four small files you can read in a few minutes.

English | [中文](README.zh.md)

## Why this exists

A DSH plugin runs in the same process as your API key. There is no permission
boundary between a plugin and the credential store, so any plugin can resolve
your key in plaintext. Whether a balance plugin does anything else with it is
purely a property of that plugin's code — and nothing verifies that for you.

Some existing balance plugins take avoidable risks to get the number:

| Risky pattern | Why it matters |
|---|---|
| Interpolating the key into a shell command | The key lands in the child process argv, readable by any process on the machine through the process list |
| Spawning `curl` and disabling the sandbox to let it run | A read-only HTTP GET never needs `danger-full-access` |
| Sending the key to whatever `baseURL` is configured | A typo or a malicious mirror exfiltrates the key |
| A local HTTP endpoint with no origin check | Any local process or web page can read your account data |

This plugin does none of those things, and the release checks assert that they
cannot creep back in.

## What it does

- Resolves `DEEPSEEK_API_KEY` through the DSH credential store on the host side
- Calls `GET https://api.deepseek.com/user/balance` with the in-process `fetch`
- Bills every model call from the harness usage chunks, at official CNY prices
  including the peak/off-peak tiers
- Returns the balance fields plus token and cost totals, and renders one
  clickable line in `sidebar.footer.action`

The line reads `Balance ¥6.39  ·  Cost ¥0.12`: the account balance and the cost
accumulated since this process started, each labelled so neither figure is
ambiguous. Both are always present — an unknown value keeps its `--` placeholder
instead of disappearing, so the row does not shift once the first call is billed.
Hovering breaks the cost down into calls and token buckets; clicking forces a
refresh.

## Cost accounting

Cost is derived from the usage chunk the harness emits for every model call, so
it reflects the requests actually made, retries included. Totals cover the
current process run and are persisted, so reloading the plugin keeps the figure;
a fresh launch starts from zero.

Prices follow the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing),
in CNY per 1M tokens:

| Model | Tier | Cache hit | Cache miss | Output |
|---|---|---|---|---|
| `deepseek-flash` | off-peak | 0.02 | 1 | 4 |
| `deepseek-flash` | peak | 0.04 | 2 | 8 |
| `deepseek-v4-pro` | off-peak | 0.15 | 4.5 | 13.5 |
| `deepseek-v4-pro` | peak | 0.30 | 9.0 | 27.0 |

Billing rules applied:

- **Peak hours** are Beijing time (UTC+8), Monday to Friday, 09:00–12:00 and
  14:00–18:00. Everything else, weekends included, is off-peak.
- **Cache writes bill at the cache-hit rate**, matching historical pricing.
- **Retired names are billed as the model that serves them**: `deepseek-v4-flash`
  and `deepseek-v4-flash-vision-exp` bill as `deepseek-flash`.
- **Unknown models cost nothing** rather than guessing a price.

Two things need deployment input because they cannot be derived: the
**Chinese public holiday calendar**, which makes a weekday off-peak, and any
price change. Both are configuration — see below.

## Security design

| Constraint | How it is enforced |
|---|---|
| The key never leaves the host process | Read through `ctx.credentials.resolve()`; never placed in a response body, a log line, or the browser |
| The key never reaches a command line | In-process `fetch` only — no subprocess, no shell. Asserted by a release check |
| No sandbox is bypassed | The plugin never reads or writes sandbox policy. Asserted by a release check |
| The key is sent only to DeepSeek | The endpoint host must equal `api.deepseek.com`; otherwise the plugin refuses to send the key. Not configurable |
| The endpoint is not cross-site readable | Requires the `x-dsh-balance: 1` header (a custom header forces a CORS preflight) and validates `Origin` against loopback |
| Failures leak nothing | Network, parse, and HTTP errors return one fixed message, never the underlying error |
| Requests are not amplified | Successful balance readings are cached; failures are never cached |

The endpoint and the credential handling are **security invariants and are deliberately not configuration options**. Only the fields listed under Configuration are tunable.

## Requirements

- DeepSeek Harness with the web client (`dsh-web-app` bundle active)
- A DeepSeek API key configured as the `DEEPSEEK_API_KEY` credential
  (Settings → Models), or exported as that environment variable
- The `deepseek-official` provider route. **The balance endpoint is official-only**: if your `baseURL` points at a gateway or mirror, the plugin refuses to send your key rather than leaking it there. Cost tracking still works, because it needs no network.

## Install

### From a local checkout

```sh
dsh plugin --profile desktop add /path/to/dsh-api-balance
```

The DSH CLI links the package into the profile and appends it to
`dsh.profile.bundles`, because this package declares `dsh.bundle`.

Installing into a profile does not require authorizing install-time code
execution: this package ships prebuilt `lib/` output and declares no `prepare`
script, so pnpm never needs `allowBuilds` for it.

### Manual install

Add the dependency and the bundle row to
`$DSH_HOME/profiles/<profile>/package.json`, then run `pnpm install` inside that
profile directory:

```json
{
  "dependencies": { "dsh-api-balance": "file:/path/to/dsh-api-balance" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-api-balance"
      ]
    }
  }
}
```

Restart DSH. The row then appears at the bottom of the left sidebar.

### If the package does not materialize

`pnpm` can report `Already up to date` and still leave
`node_modules/dsh-api-balance` missing, when a stale lockfile importer records
the dependency as satisfied. Confirm what actually landed:

```sh
ls "$DSH_HOME/profiles/<profile>/node_modules/dsh-api-balance/lib"
```

If `lib/` is absent, link the profile entry at your checkout so the profile reads
it directly. On Windows:

```bat
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-api-balance" "C:\path\to\dsh-api-balance"
```

On macOS or Linux:

```sh
ln -s /path/to/dsh-api-balance "$HOME/.dsh/profiles/desktop/node_modules/dsh-api-balance"
```

A link has a second benefit for development: edits to the checkout take effect
without reinstalling. It also means `pnpm install` in that profile may replace
the link, so re-create it if the package disappears again.

### Verify the installation


Open the browser console in the GUI and run:

```js
fetch('/api/dsh-api-balance', { headers: { 'x-dsh-balance': '1' } }).then(r => r.json()).then(console.log)
```

An `{ ok: true, currency: "CNY", totalBalance: "...", usage: { total: { cost: ... } } }`
object means the host half is live. A `404` means the loader row did not
activate; a `403` means the request reached the route without the required
header or from another origin.

## Troubleshooting

### The row renders but says `Balance unavailable`

Hover the row, or run the console snippet above, to read the reason. `HTTP 404`
means the host half never registered its route, which is an activation fault and
not a credential problem; check the activation log described below.

### Checking plugin activation

The plugin appends its activation steps to `dsh-api-balance/plugin.log` inside
the per-user temporary directory (`%TEMP%` on Windows, `$TMPDIR` elsewhere). Set
`DSH_BALANCE_DIAG=<dir>` to redirect it. A healthy activation records four lines:

```
module evaluated (exports: name=api-balance, apply=function)
apply() entered; config={}
inject callback fired
webServer resolved: function
```

That log exists because activation failure is otherwise invisible: the plugin
still renders its row while contributing nothing, and no framework log records
the fault. What the log tells you:

| Log contents | Meaning |
|---|---|
| File absent | The loader never imported the module: the bundle row did not resolve |
| `module evaluated` only | The module loaded but the framework refused it. Check the `Config` export first: Cordis requires a present `Config` to implement Standard Schema (`Config["~standard"].validate`) and aborts activation when it does not |
| `apply() entered` without `inject callback fired` | A declared dependency never became available, so the route was never registered |
| All four lines | Activation is healthy; the fault is in the request or the credential |

The log holds service names, resolution outcomes, and status codes only. It never
contains the API key.

### The `Config` export trap

This plugin exports `Config` only when `@deepseek-ai/schemastery` resolves **and**
its product implements Standard Schema. Exporting a schema that cannot validate
is worse than exporting none: Cordis calls `Config["~standard"].validate(config)`
before `apply`, and that throw removes every contribution the plugin makes while
leaving the UI intact. A plugin that renders but does nothing is almost always
this fault.

## Configuration

Optional, in the profile's `cordis.yml`/`cordis.patch.yml`:

```yaml
- id: api-balance
  name: dsh-api-balance
  config:
    cacheMs: 60000
    path: /api/dsh-api-balance
    persistUsage: true
    holidays:
      - '2026-10-01'
      - '2026-10-02'
    prices:
      deepseek-flash:
        cacheHit: 0.02
        cacheMiss: 1
        output: 4
        peak:
          cacheHit: 0.04
          cacheMiss: 2
          output: 8
```

| Field | Default | Meaning |
|---|---|---|
| `cacheMs` | `60000` | Lifetime of a cached balance reading, in milliseconds (0 – 3600000) |
| `path` | `/api/dsh-api-balance` | Exact HTTP route serving the payload |
| `persistUsage` | `true` | Persist usage totals so a plugin reload keeps this run's cost |
| `holidays` | `[]` | Beijing holiday dates (`YYYY-MM-DD`) billed at off-peak rates |
| `prices` | built-in | Override or extend the price table, CNY per 1M tokens |

Usage totals live in `$DSH_HOME/storages/api-balance/usage.json`.

## Development

There is no build step: the files under `lib/` are the shipped artifacts.
`lib/client.js` is a hand-written bundle in the DSH `window.__ModuleLoader__`
format, and `lib/types/index.d.ts` carries the public types.

```sh
node scripts/verify.mjs           # offline checks, no credentials
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # adds one real query
```

`scripts/verify.mjs` asserts the manifest contract, the loader patch, the host
export surface, the security invariants above, the pricing arithmetic and peak
windows, ledger persistence, the route's rejection behaviour, stream
accounting, and the client bundle contract. It needs no DSH installation and no
network unless `--live` is passed.

**Client bundle id rule.** The module id passed to `window.__ModuleLoader__.load`
must equal the package name. A mismatched id makes the browser module system
reject the factory and fails the entire web boot entry with
`duplicate factory registration`, which stops the application from starting.
`scripts/verify.mjs` guards this explicitly — keep that check.

## Rollback

Remove `"dsh-api-balance"` from `dsh.profile.bundles` in the profile's
`package.json` and restart. If the application refuses to start, the DSH error
dialog offers **Disable third-party plugins and restart**, which performs this
recovery for you.

## Limitations

- Official balance endpoint only; gateway and mirror `baseURL` values are refused by design
- Cost covers the current process run, not history from earlier runs
- Chinese public holidays are off-peak only when listed in `holidays`; the official calendar is not knowable in advance
- Prices are built in and must be updated when DeepSeek changes them
- Only the first entry of `balance_infos` is shown
- The collapsed sidebar shows a shortened label

## License

[Apache-2.0](LICENSE)
