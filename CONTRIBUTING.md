# Contributing

Thanks for considering a contribution. This plugin is small on purpose: it does
one read-only thing and its value comes from being auditable in a few minutes.
Changes that grow the surface need a clear justification.

## Before you start

Read [SECURITY.md](SECURITY.md). Anything touching the credential path, the
endpoint resolution, or the HTTP route is a security change and is reviewed as
one.

## Development setup

There is no build step and no runtime dependency to install. `lib/index.js` and
`lib/client.js` are the shipped artifacts.

```sh
git clone https://github.com/CH2008445/dsh-api-balance.git
cd dsh-api-balance
node scripts/verify.mjs
```

Node.js 20 or newer is required.

## Running the checks

```sh
node scripts/verify.mjs                                  # offline, no credentials
BALANCE_TEST_KEY=sk-... node scripts/verify.mjs --live   # adds one real query
```

The offline run is the gate. It asserts the manifest contract, the loader patch,
the host export surface, the security invariants, the route's rejection
behaviour, and the client bundle contract. Run `--live` only when you need to
confirm the real endpoint still answers as expected; it needs a valid key and
network access.

Keep the checks passing. If a check blocks a legitimate change, change the check
deliberately in the same commit and explain why in the message.

## Hard rules

These exist because breaking them has already caused real failures or real
exposure:

1. **The client bundle module id must equal the package name.** A mismatch fails
   the entire web boot entry with `duplicate factory registration` and the
   application will not start. `scripts/verify.mjs` guards this.
2. **Never send the API key anywhere but `api.deepseek.com`.** Do not make the
   endpoint configurable.
3. **Never introduce a subprocess or a shell call for the balance request.**
4. **Never put the key in a response body, a log line, or an error message.**
   Return a fixed message instead.
5. **Keep the host export surface to `name`, `apply`, `inject`, and `Config`.**
6. **Document any new option in `Config` and in both READMEs.** Values that
   differ per deployment belong in the schema, not in a constant.

## Style

- ES modules, no TypeScript build step; types live in `lib/types/*.d.ts`.
- Two-space indentation for `lib/index.js` and four-space for `lib/client.js`,
  matching each file's existing style.
- Comments state contracts and non-obvious constraints. Do not narrate control
  flow or explain what the next line obviously does.
- Files end with exactly one trailing newline.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add a compact display mode
fix: refuse a baseURL that cannot be parsed
docs: clarify the rollback steps
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

## Pull requests

- One logical change per pull request.
- Include the `node scripts/verify.mjs` output in the description.
- Update `CHANGELOG.md` under `## [Unreleased]` for user-visible changes.
- Update both `README.md` and `README.zh.md` together; they are a pair.
