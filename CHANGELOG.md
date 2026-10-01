# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-10-01

### Added

- The sidebar row shows both figures at once, each labelled: `Balance ¥6.39  ·  Cost ¥0.12`. An unknown value keeps its placeholder rather than disappearing, so the row does not shift once the first call is billed.
- Activation log under the per-user temporary directory (`dsh-api-balance/plugin.log`, redirected by `DSH_BALANCE_DIAG`). It records the activation steps and resolution outcomes, never the key, and exists because a plugin whose `apply` never runs is otherwise invisible: it still renders its UI while contributing nothing.

### Fixed

- **Activation aborted when `@deepseek-ai/schemastery` could not be resolved.** A stand-in schema was exported as `Config`, and Cordis validates a present `Config` through the Standard Schema interface (`Config["~standard"].validate`), so the stand-in threw before `apply` ran. The plugin then loaded, rendered its row, and registered no host route: every request answered `404`, and nothing reached any log. `Config` is now exported only when the real schema resolves and its product implements Standard Schema; otherwise it is omitted and Cordis passes the raw config. This is a regression introduced in 1.1.0, where `apply` was the module's only export.
- The activation log no longer writes inside the package directory, so an installed copy never dirties `node_modules`.

## [1.1.0] - 2026-10-01

### Added

- Per-run usage cost, billed from the usage chunk the harness emits for every
  model call, so the figure reflects the requests actually made including
  retries.
- Official CNY price table with peak and off-peak tiers for `deepseek-flash` and
  `deepseek-v4-pro`.
- Peak-hour classification in Beijing time: Monday to Friday 09:00-12:00 and
  14:00-18:00, with weekends and configured holidays treated as off-peak.
- `holidays` config field for the Chinese public holiday calendar, which cannot
  be derived in advance.
- `prices` config field to override or extend the price table when DeepSeek
  changes its rates.
- `persistUsage` config field. Usage totals persist to
  `$DSH_HOME/storages/api-balance/usage.json` and are keyed by process start, so
  a plugin reload keeps the running figure while a new launch starts from zero.
- `lib/pricing.js` and `lib/usage-ledger.js`, kept separate from the plugin
  entry so the arithmetic and persistence are testable in isolation.
- Sidebar footer now shows balance and run cost on one line, with the tooltip
  breaking the cost down into calls and token buckets.

### Changed

- Retired model names bill as the model that serves them: `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` bill at `deepseek-flash` rates.
- Cache writes bill at the cache-hit rate, matching official historical pricing.
- Unknown model ids cost zero rather than guessing a price.
- The balance cache no longer hides cost: usage accompanies a failed balance read,
  because the cost of the run needs no network.

### Fixed

- Usage ledger now persists its session set, which was previously kept in memory
  only and lost on reload.

## [1.0.0] - 2026-10-01

### Added

- Sidebar footer balance row in the DSH web GUI, registered into
  `sidebar.footer.action`, with click-to-refresh and a five-minute automatic
  refresh.
- Host half that resolves `DEEPSEEK_API_KEY` through the DSH credential store and
  queries `GET https://api.deepseek.com/user/balance` with the in-process
  `fetch`.
- Official-host allowlist: the API key is never sent when the configured
  `baseURL` is not `api.deepseek.com`.
- Route protection requiring the `x-dsh-balance` header plus a loopback `Origin`.
- Successful readings cached for 60 seconds; failures never cached.
- `Config` schema exposing `cacheMs` and `path`. The endpoint and credential
  handling remain fixed security invariants.
- `scripts/verify.mjs` release checks covering the manifest contract, the loader
  patch, the host export surface, the security invariants, the route rejection
  behaviour, and the client bundle contract.
- Bilingual documentation, an Apache-2.0 license, and CI.

### Fixed

- Client bundle module id now equals the package name. A mismatch made the
  browser module system reject the factory and failed the whole web boot entry
  with `duplicate factory registration`, preventing the application from
  starting. Covered by a regression check.
- Host half reaches the web server through `ctx.get('webServer')` instead of a
  direct property, matching the documented service access.
- `@deepseek-ai/schemastery` is loaded optionally, so the plugin also loads
  outside a DSH install and the release checks run standalone.

[Unreleased]: https://github.com/CH2008445/dsh-api-balance/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/CH2008445/dsh-api-balance/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/CH2008445/dsh-api-balance/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CH2008445/dsh-api-balance/releases/tag/v1.0.0
