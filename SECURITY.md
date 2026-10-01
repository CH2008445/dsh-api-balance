# Security Policy

## Reporting a vulnerability

Report security issues privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. Please do not open a public issue for a vulnerability.

Include the affected version, a description of the impact, and the smallest
reproduction you can manage. Expect an acknowledgement within a few days.

## What this plugin handles

The plugin reads the DeepSeek API key through the DSH credential store and sends
it to exactly one host. The following are therefore treated as security
invariants, not features, and a change to any of them is a security change:

1. The key is resolved only through `ctx.credentials.resolve()`.
2. Requests use the in-process `fetch`. No subprocess and no shell is started.
3. No sandbox policy is read or modified.
4. The endpoint host must equal `api.deepseek.com`.
5. The key never appears in a response body, a log line, or an error message.
6. The HTTP route requires the `x-dsh-balance` header and a loopback `Origin`.

`scripts/verify.mjs` asserts invariants 2, 3, 4, and 5 on every run, plus the
route's rejection behaviour for invariant 6. If you change code guarded by those
checks, keep the checks passing rather than relaxing them.

## Known and accepted limitations

These are documented trade-offs, not vulnerabilities:

- **Any DSH plugin runs in the same process as the credential store.** DSH
  provides no isolation between plugins and credentials, so a plugin you install
  can read your key. This plugin does not change that; it only avoids adding
  further exposure. Install third-party plugins only from sources you have read.
- **The route is protected by a custom header and an origin check**, not by
  authentication. This is sufficient to stop cross-site reads from a browser.
  A local process that already runs as your user can read the balance figure,
  which is not a secret in the sense the API key is.
- **The balance figure itself is returned to the browser.** It is displayed to
  the user, so it cannot be kept host-side.
