# Cloud anchor: credential verification

**Date**: 2026-06-14
**Status**: Parked (not a CLI feature) — captured as the anchor feature for a future envpkt cloud offering.

## Decision

`envpkt verify` (issue #42 — liveness probing of credentials) is **not** being built into the
OSS CLI. Verification is the most cloud-shaped capability on the roadmap, and it's the cleanest
open-core boundary envpkt has — so it's reserved as the hosted product's anchor feature.

## Why verification is cloud-shaped, not CLI-shaped

A local, on-demand, single-machine `envpkt verify` is a fraction of the value. The value of
verification is **continuous and fleet-wide**:

- **Scheduled** probes (not ad-hoc from a developer's shell).
- **History** — "this key went dead Tuesday 03:14"; trend of health over time.
- **Alerting** — notify when a credential stops authenticating or nears expiry.
- **Fleet rollup** — one dashboard across every agent/package's credentials.
- **Centralized audit log** of every check.

It also handles, server-side and correctly, the things that made ad-hoc local probing risky:
a verification call is itself a credential _use_ (it shows in provider audit logs, consumes
rate limits, can trip anomaly detection). Centralized scheduling with backoff is the right home
for that — not every contributor's terminal firing authenticated calls at prod providers.

## Open-core boundary

- **OSS CLI** — the local credential _lifecycle_: `scan → seal → exec`/`shell-hook`/`dotenv`
  → `audit` → `doctor`. Offline, no outbound authenticated calls baked into the local trust story.
- **Cloud** — verification: the probe engine, the per-service probe registry, scheduling,
  history, claimed-vs-observed-over-time, alerts, fleet rollup. This is the differentiator we kept
  returning to: not just "what does the credential _claim_" but "is it actually live, over time,
  across the fleet."

## Probe architecture: how the cloud verifies without holding the value

The central trust question: verification _requires_ an authenticated call with the real secret
value, but envpkt's differentiator is that it never sees values. The resolution is to **move the
prober to the key, not the key to the prober** — split orchestration (cloud) from execution
(customer trust zone).

```
┌─ envpkt cloud ─────────────┐         ┌─ customer trust zone ──────────┐
│ • schedule (probe key X now)│  push   │  envpkt runner (headless)       │
│ • probe registry (endpoints)│ ──────▶ │  • resolves value locally       │
│ • history / alerting /      │         │    (sealed → fnox → env)        │
│   fleet rollup              │ ◀────── │  • makes the authed call        │
└─────────────────────────────┘ report  │  • reports VERDICT only         │
   holds: metadata, schedules,          └────────────────────────────────┘
   verdicts — never a value                 holds + uses the value; never
                                            sends it anywhere
```

What crosses the boundary:

- **Inbound to runner:** "probe `STRIPE_SECRET_KEY` against `GET /v1/account` now." Non-sensitive —
  a public endpoint name from the registry.
- **Outbound to cloud:** `{ key, status: "alive", http: 200, latency_ms, checked_at }`. A verdict,
  not a value.

The secret resolves, is used, and is discarded entirely inside the customer's zone, in-process.
This is not a new trust tier — it is envpkt's existing three-tier model running headless: the
runner _is_ the `boot()`/runtime tier (value in-process, outside any LLM context); cloud is the
MCP-equivalent tier (no value access, ever). Pattern precedent: Datadog agent, Vault agent,
Checkly private runners.

### Two on-ramps onto the same model

- **Runner (flagship):** thin headless deploy in the customer's CI / sidecar / Worker. Scheduled,
  automatic, fleet-wide. This is the product.
- **Result ingestion (zero-trust entry):** customer probes however they like (even a local
  `envpkt verify --once`) and `POST`s verdicts to cloud for history/alerting/rollup. Cloud is pure
  aggregation — needs nothing from inside their zone but the verdicts. Lowest barrier to first value.

### Consciously rejected: cloud custody of the value

The easy alternative — customer hands the value to the cloud (KMS/age-encrypted at rest), cloud
decrypts in memory at probe time, calls, discards — is what Doppler/Infisical/1Password do. It is
**rejected for envpkt.** The moment the cloud can decrypt a secret, envpkt stops being "the sidecar
that never sees your values" and becomes another secret vault competing with incumbents. The
differentiator is exactly the thing that path gives up.

### Caveat: observed data in probe responses

Some verify endpoints return identity (whoami → account email/org; SendGrid → scopes). That is
_observed_ data. The runner normalizes to a verdict before reporting up — default minimal (status
only); customer opts in to echoing observed scopes/identity into history. Same "report observed,
never render a matches-verdict" discipline noted under scope below.

## Scope notes carried over from #42

- **Liveness, not capability/scope introspection.** Mapping provider permission models onto a
  capabilities vocabulary is an open-ended ontology problem; most providers don't expose scopes.
  Report observed alongside claimed; never render a "matches" verdict.
- **Probe model.** Generic `check_url` + expected status for the long tail; built-in presets for
  known services (GitHub `GET /user`, Stripe `GET /v1/account`, OpenAI `GET /v1/models`,
  Slack `auth.test`, …). AWS needs SigV4 or `sts get-caller-identity` — handle deliberately.
- **Results** feed a freshness signal (the "stale since last verified" half of #43). With
  verification in the cloud, that freshness dimension lives there too; #43's `--strict` exit on
  expired/drifted remains a standalone CLI capability.

## Adjacent: registry-vs-deployment sync (`envpkt diff <backend>:<target>`)

Distinct from verification (claimed-vs-**live**), this is claimed-vs-**deployed**: does a
deployment target's secret store actually contain the keys the registry declares? First
reference implementation lives in **agent-todo** (`scripts/check-secret-sync.sh`, 2026-06-20):
`envpkt resolve --format json` (declared, minus CI-only `team`/`sink = "ci"`) diffed against
`wrangler secret list` (Cloudflare reality) — names only, never values.

**Boundary — thin tool / fat orchestration.** envpkt stays the cloud-agnostic registry
exposing structured data (`resolve --format json`); each cloud's native CLI
(`wrangler` / `aws` / `vault`) owns deployment-side reality; a small orchestration script
diffs the two. envpkt is _consumed_, not bypassed — exactly what a registry should enable.

**Trigger to formalize — YAGNI until 2+ backends.** When a second/third script appears
(AWS Secrets Manager, Vault, k8s, dotenv…), move the diff logic into envpkt as a generic
command with a pluggable backend interface:

```
envpkt diff cloudflare:agent-gate-api
envpkt diff aws-sm:my-app
envpkt diff vault:agent-gate
```

The shell script becomes the reference that informs the API shape; core stays
cloud-agnostic, backends opt-in. Until then the abstraction is longer than the script —
don't build it.

## Status of related issues

- **#42** — closed as "cloud anchor, not CLI." This doc holds the framing.
- **#43** — the `--strict` exit-on-expired/drifted half is still CLI-viable; the
  freshness-since-last-verified half moves to cloud with verification.
