# Cloud free tier: viewer, expiry alerts, share links

**Date**: 2026-10-24
**Status**: Draft. Decisions 1–3 are Jordan's; 4 and 5 are recommendations awaiting his call.

## Summary

Three cloud features need no secret values, so they can ship ahead of verification (#42, the
liveness epic) and serve as the free tier:

1. **Viewer** — drop an `envpkt.toml` on a web page and see the same health view `envpkt inspect`
   prints. Parsing runs in the browser; nothing is uploaded.
2. **Expiry alerts** — the cloud keeps a value-free copy of each config and emails (or posts) when
   a key is expiring or expired.
3. **Share links** — upload a value-free copy and get a private link to the rendered view.

All three run the same code: parse → validate → `computeAudit` → render. Today that code only runs
under Node. Making it run in a browser and a Worker is the first step, and everything else builds
on it.

| Feature                                              | Tier                     |
| ---------------------------------------------------- | ------------------------ |
| Viewer (no upload)                                   | Free                     |
| Expiry alerts, a few configs                         | Free                     |
| Private share links                                  | Free, with limits        |
| Liveness checks, history, fleet rollup, team sharing | Paid (#42 epic, #55–#62) |

## Relation to the June plan

`2026-06-14-cloud-verification.md` drew the line as: OSS CLI = offline lifecycle, cloud =
verification. This plan adds a cloud slice that sits before verification. Expiry alerting is half of
#61 (alerting and fleet rollup); the other half — "stopped authenticating" — still needs the runner
(#59) and stays paid. Nothing here changes the June trust model: the cloud never holds a value, and
these features never need one.

## Step 0: a core entry that runs outside Node

Two things stop the core from running in a browser or a Cloudflare Worker today:

- **`src/core/config.ts` imports Node.** It pulls in `node:path` and `functype-os` for path
  resolution and file loading, next to the pure `parseToml` and `validateConfig`.
- **Validation generates code.** `config.ts:15` runs `TypeCompiler.Compile(EnvpktConfigSchema)` when
  the module loads. TypeBox's compiler builds the checker with `new globalThis.Function(...)`
  (`@sinclair/typebox/build/esm/system/evaluate.mjs`). Cloudflare Workers forbid building code from
  strings, and so does a strict page CSP, so importing `config.ts` fails there.

What is already clean: `computeAudit` (`src/core/audit.ts`, imports only functype and
`namespace.ts`, and takes a `today` argument) and `formatPacket` (`src/core/format.ts`, imports only
functype).

**Change:** split the pure functions out of `config.ts` and publish a second entry, `envpkt/core`,
that exports `parseToml`, a validator built on `Value.Check` / `Value.Errors` from
`@sinclair/typebox/value` (no codegen), `computeAudit`, `formatPacket` and the redaction function
below. Node code keeps the compiled validator for speed. A test imports `envpkt/core` with Node
built-ins blocked, so a stray import fails CI.

## Redaction: one allowlist, used everywhere

A config can carry more than metadata:

- `[secret.*].encrypted_value` — ciphertext.
- `[env.*].value` — plaintext defaults.
- `identity.key_file` and `catalog` — local paths.

The MCP server already strips `encrypted_value` and `from_key`, inline in `src/mcp/tools.ts:218`.
Lift that into `src/core/redact.ts` as an **allowlist** of fields that may leave the machine, so a
new schema field stays private until someone adds it on purpose. The MCP tools, the upload command
and the viewer's "copy share link" all call it.

Defense in depth: the CLI redacts before upload, and the cloud rejects any payload that still has a
value-shaped field (the same rule #60 sets for verdict ingest). A spec seals a config, redacts it,
and asserts no ciphertext, `[env]` value or local path survives.

Free-text fields (`purpose`, `comment`) are metadata but can hold notes people don't want shared.
The upload command lists what it will send and asks first; `--yes` skips the prompt in CI.

## Expiry alerts: store the config, not the audit

Two ways to feed the cloud:

- **Upload `audit --format json`.** Already value-free, but `days_remaining` is fixed at the moment
  of upload. If nobody pushes for a month, the cloud never learns a key crossed its expiry.
- **Upload the redacted config and rerun the audit daily.** A Cron Trigger calls
  `computeAudit(config, undefined, today)` for every stored config and alerts on status changes.

**Pick the second.** It is the reason step 0 matters for alerts as well as the viewer.

Details:

- **Catalogs.** A config that points at a catalog is incomplete on its own. The CLI resolves the
  catalog first (the `inspect --resolved` view) and uploads the merged result.
- **Staleness.** The cloud only knows the last upload. Every alert and view shows "uploaded <date>",
  and a weekly digest flags configs not refreshed in N days.
- **Getting uploads to happen.** The GitHub Action gets an `upload: true` input, so a push to `main`
  refreshes the copy. A CLI command covers everything else.
- **Alert rule.** Alert when a key enters `expiring_soon` or `expired`, and once more if it's still
  there 7 days later. Alerting on every daily run would be noise.

## Share links

- Upload stores a redacted snapshot and returns an unguessable URL, private by default.
- The page renders it with the same `envpkt/core` code as the viewer.
- Free: link-only access with an expiry date and a revoke button. Paid: named viewers and
  team-wide views (that's where fleet rollup lands).
- Metadata still reveals your stack (service names, capabilities, rotation URLs), so the upload
  prompt says so plainly.

## Build order and issues to open

0. **Cloud repo** — private `envpkt-cloud`, scaffolded from ts-builds-template like Mnemons.
1. **Core entry** — `envpkt/core`, codegen-free validator, Node-free test. OSS, this repo.
2. **Redaction** — `src/core/redact.ts`, MCP switched to it, value-leak spec. OSS, this repo.
3. **Viewer** — a page on the docs site that parses a dropped file in the browser. OSS.
4. **Upload command + Action input** — CLI side of alerts and sharing. OSS.
5. **Cloud: storage, daily audit, alerts** — Worker + database + cron + email. Cloud.
6. **Cloud: share links** — snapshot store, link page, revoke. Cloud.

Steps 1–3 ship value with no cloud at all. Step 4 is useless until 5 exists, so they land together.

## Risks

- **Trust.** "Upload your config" is the first time envpkt sends anything anywhere. Redaction has to
  be right the first time, and the docs have to show exactly what leaves the machine.
- **Stale copies.** Alerts reflect the last upload, not the repo. Mitigated by the Action input and
  the staleness digest, not solved.
- **Naming.** #66 (sink-aware push and sync check) already claims "push" and "sync" for sending
  secrets to platforms. The upload command needs a name that can't be confused with that.

## Decisions

1. **Alert channel** — email first, then GitHub issues. Slack later. _(Jordan)_
   - Email goes through Cloudflare Email Service: a `send_email` Worker binding, no API key to
     manage. It needs the sending domain on Cloudflare DNS (`envpkt.com` is) and Workers Paid, which
     the stack needs anyway. 3,000 emails a month are included, then $0.35 per 1,000. New accounts
     start on a small daily quota that grows with good sending. Transactional mail only, which
     expiry alerts are.
   - GitHub issues need a GitHub App installed on the user's repo, so they come second.
2. **Platform** — Cloudflare, on the Mnemons stack: Hono on Workers, Neon Postgres through
   Hyperdrive with Kysely, Better Auth, Cron Triggers for the daily audit, and a React 19 + Vite +
   Mantine UI. Tests run on pglite. Neon over D1 so both projects share migrations, query patterns
   and test setup. _(Jordan)_
3. **Repo** — a new private `envpkt-cloud`. `envpkt/core`, redaction, the upload command and the
   no-upload viewer stay in OSS envpkt. _(Jordan)_
4. **Auth** — _recommended:_
   - Web: Better Auth with GitHub and Google sign-in.
   - CI uploads: GitHub Actions OIDC. The Action requests a short-lived token, the cloud verifies it
     against GitHub's keys and maps the repo to a project. No stored secret, the same pattern as
     npm trusted publishing.
   - Laptop uploads: a token made in the dashboard, read from `ENVPKT_CLOUD_TOKEN`. A browser
     sign-in from the CLI can come later.
5. **Command name** — _recommended:_ an `envpkt cloud` group, starting with `envpkt cloud upload`
   (`--dry-run` prints exactly what would leave the machine, `--share` also prints a link). It stays
   clear of #66's "push" and "sync".

## Web views

One React app in `envpkt-cloud`, every page rendering through `envpkt/core` so it matches
`envpkt inspect`:

- `/view` — the step 3 viewer (drop a toml, parsed in the browser, nothing uploaded, no account),
  mounted here as well as on the docs site.
- `/s/<id>` — a share link, rendering the redacted copy.
- `/dashboard` — your configs, expiry status, alert settings and share links.
