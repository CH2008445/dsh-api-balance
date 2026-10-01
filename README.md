# dsh-api-balance

Read-only **DeepSeek API account balance** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI. The balance appears in the sidebar footer and refreshes on its own.

Built for one purpose: showing your balance **without widening the blast radius of your API key**. The whole plugin is two small files you can read in a few minutes.

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
- Returns four fields to the UI: `currency`, `total_balance`, `granted_balance`, `topped_up_balance`
- Renders one clickable line in `sidebar.footer.action`

## Security design

| Constraint | How it is enforced |
|---|---|
| The key never leaves the host process | Read through `ctx.credentials.resolve()`; never placed in a response body, a log line, or the browser |
| The key never reaches a command line | In-process `fetch` only — no subprocess, no shell. Asserted by a release check |
| No sandbox is bypassed | The plugin never touches sandbox policy. Asserted by a release check |
| The key is sent only to DeepSeek | The endpoint host must equal `api.deepseek.com`; otherwise the plugin refuses to send the key. Not configurable |
| The endpoint is not cross-site readable | Requires the `x-dsh-balance: 1` header (a custom header forces a CORS preflight) and validates `Origin` against loopback |
| Failures leak nothing | Network, parse, and HTTP errors return one fixed message, never the underlying error |
| Requests are not amplified | Successful readings are cached for 60 s; failures are never cached |

The endpoint and the credential handling are **security invariants and are deliberately not configuration options**. Only `cacheMs` and `path` are tunable.

## Requirements

- DeepSeek Harness with the web client (`dsh-web-app` bundle active)
- A DeepSeek API key configured as the `DEEPSEEK_API_KEY` credential
  (Settings → Models), or exported as that environment variable
- The `deepseek-official` provider route. **The balance endpoint is official-only**: if your `baseURL` points at a gateway or mirror, the plugin refuses to send your key rather than leaking it there.

## Install

### From a local checkout

```sh
dsh plugin --profile desktop add /path/to/dsh-api-balance
```

The DSH CLI links the package into the profile and appends it to
`dsh.profile.bundles`, because this package declares `dsh.bundle`.

Installing into a profile means "run during installation" is not required: this
package ships prebuilt `lib/` output and declares no `prepare` script, so pnpm
never needs `allowBuilds` authorization for it.

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

> Tip: if `pnpm install` reports "Already up to date" without materializing the
> package (a stale lockfile importer can cause this), point the profile's
> `node_modules/dsh-api-balance` at your checkout with a directory junction —
> `mklink /J` on Windows — so the profile always reads your working copy.

### Verify the installation

Open the browser console in the GUI and run:

```js
fetch('/api/dsh-api-balance', { headers: { 'x-dsh-balance': '1' } }).then(r => r.json()).then(console.log)
```

A `{ ok: true, currency: "CNY", totalBalance: "...", ... }` object means the host
half is live. A `404` means the loader row did not activate; a `403` means the
request reached the route without the required header or from another origin.

## Configuration

Optional, in the profile's `cordis.yml`/`cordis.patch.yml`:

```yaml
- id: api-balance
  name: dsh-api-balance
  config:
    cacheMs: 60000
    path: /api/dsh-api-balance
```

| Field | Default | Range | Meaning |
|---|---|---|---|
| `cacheMs` | `60000` | 0 – 3600000 | Lifetime of a cached reading, in milliseconds |
| `path` | `/api/dsh-api-balance` | — | Exact HTTP route serving the balance JSON |

## Development

There is no build step: `lib/index.js` and `lib/client.js` are the shipped
artifacts. `lib/client.js` is a hand-written bundle in the DSH
`window.__ModuleLoader__` format, and `lib/types/index.d.ts` carries the public
types.

```sh
node scripts/verify.mjs           # offline checks, no credentials
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # adds one real query
```

`scripts/verify.mjs` asserts the manifest contract, the loader patch, the host
export surface, the security invariants above, the route's rejection behaviour,
and the client bundle contract. It needs no DSH installation and no network
unless `--live` is passed.

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

- Official endpoint only; gateway and mirror `baseURL` values are refused by design
- Only the first entry of `balance_infos` is shown
- The collapsed sidebar shows the amount without the label
- The reading is cached for `cacheMs`; use the row's click action to force a refresh

## License

[Apache-2.0](LICENSE)
