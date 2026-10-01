# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/CH2008445/dsh-api-balance/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CH2008445/dsh-api-balance/releases/tag/v1.0.0
