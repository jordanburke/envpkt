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
a verification call is itself a credential *use* (it shows in provider audit logs, consumes
rate limits, can trip anomaly detection). Centralized scheduling with backoff is the right home
for that — not every contributor's terminal firing authenticated calls at prod providers.

## Open-core boundary

- **OSS CLI** — the local credential _lifecycle_: `scan → seal → exec`/`shell-hook`/`dotenv`
  → `audit` → `doctor`. Offline, no outbound authenticated calls baked into the local trust story.
- **Cloud** — verification: the probe engine, the per-service probe registry, scheduling,
  history, claimed-vs-observed-over-time, alerts, fleet rollup. This is the differentiator we kept
  returning to: not just "what does the credential _claim_" but "is it actually live, over time,
  across the fleet."

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

## Status of related issues

- **#42** — closed as "cloud anchor, not CLI." This doc holds the framing.
- **#43** — the `--strict` exit-on-expired/drifted half is still CLI-viable; the
  freshness-since-last-verified half moves to cloud with verification.
