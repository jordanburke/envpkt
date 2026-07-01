# envpkt

[![Node.js CI](https://github.com/jordanburke/envpkt/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/envpkt/actions/workflows/node.js.yml)
[![npm version](https://img.shields.io/npm/v/envpkt.svg)](https://www.npmjs.com/package/envpkt)

**Credentials your agents actually understand.**

envpkt gives every credential an `envpkt.toml` entry describing _what service it authenticates to_, _what it's allowed to do_, _when it expires_, and _how to rotate it_ — while the secret values stay in your secrets manager, encrypted at rest, or injected at runtime, never committed in plaintext.

**Day one, with zero agents,** it's an encrypted-at-rest `.env` replacement with scoped loading: scan the credentials already in your shell, seal them into a file that's safe to commit, and load them automatically on `cd`, into a single command, or as a plain `.env` for any tool that wants one.

**As you add agents,** the same metadata gives them structured awareness of their own credentials over [MCP](#for-agents-and-fleets) — capabilities, expiry, drift, fleet health — without any secret value ever entering the model's context window.

## Quick Start

The whole loop for a single project — discover, seal, load — with zero agents involved:

```bash
npm install -g envpkt

# 1. Discover the credentials already in your shell, and scaffold envpkt.toml from them
envpkt env scan
envpkt env scan --write

# 2. Generate an age key and seal the secret values into envpkt.toml (the file is safe to commit)
envpkt keygen
envpkt seal

# 3. Load them — pick whatever fits the moment:
envpkt exec -- your-tool            # run one command with the secrets injected, scoped to it
eval "$(envpkt shell-hook zsh)"     # add to ~/.zshrc: auto-load on cd into a project, restore on leave
envpkt env dotenv -o .env           # materialize a .env for Docker / Wrangler / Vite / …

# Anytime: check health and drift
envpkt audit
envpkt env check
```

Encrypted secrets committed to git, loaded where you need them, with health you can audit — and not an agent in sight. Scaling the same metadata to agents and fleets is [act two](#for-agents-and-fleets).

## Security Model

envpkt operates a three-tier trust model. Each tier has different guarantees, and we're explicit about what each one protects against.

**Tier 1: MCP metadata (agent-facing)** — The MCP server never returns raw credential values. This isn't a policy choice — architecturally, the server reads `envpkt.toml` which contains metadata (service names, capabilities, expiration dates, rotation URLs) but never plaintext secrets. The agent gets structured awareness of its constraints without any secret material entering the LLM context window. Prompt injection attacks cannot leak what isn't there.

**Tier 2: Runtime injection (process-facing)** — `boot()` resolves secrets (from sealed packets, fnox, or environment variables) and injects them into `process.env` at startup, outside the LLM context. This is the same trust model as every Node.js application that reads from `.env`, except now secrets are encrypted at rest, scoped per-agent, and auditable. This is defense-in-depth against prompt injection — the most common attack vector — but it is not a hard boundary against agents with code execution capabilities.

**Tier 3: Shell-level agents** — Agents with shell access (Claude Code, Devin, etc.) can read environment variables directly. Prevention isn't possible at this tier. envpkt provides encrypted storage, scoped access, and audit trails — because when prevention isn't possible, visibility is what matters.

## The envpkt.toml File

Every project gets one `envpkt.toml` that describes its credentials. Here's a minimal example:

```toml
#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json

version = 1

[secret.API_KEY]
service = "stripe"
```

And a more complete one:

```toml
#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json

version = 1

[identity]
name = "billing-service"
consumer = "agent"
description = "Payment processing agent"
capabilities = ["charge", "refund"]
expires = "2027-01-01"

[lifecycle]
stale_warning_days = 90
require_expiration = true
require_service = true

[secret.STRIPE_SECRET_KEY]
service = "stripe"
purpose = "Process customer payments and manage subscriptions"
capabilities = ["charges:write", "subscriptions:write"]
created = "2026-01-15"
expires = "2027-01-15"
rotation_url = "https://dashboard.stripe.com/apikeys"
source = "vault"

[secret.DATABASE_URL]
service = "postgres"
purpose = "Read/write access to the billing database"
capabilities = ["SELECT", "INSERT", "UPDATE"]
created = "2026-02-01"
expires = "2026-08-01"
rotation_url = "https://wiki.internal/runbooks/rotate-db-creds"
source = "vault"
```

For non-secret configuration defaults (runtime mode, log levels, etc.), use `[env.*]`:

```toml
[env.NODE_ENV]
value = "production"
purpose = "Runtime environment mode"
comment = "Override to 'development' for local testing"

[env.LOG_LEVEL]
value = "info"
purpose = "Application log verbosity"
```

### Aliases

When a consumer hardcodes a different env var name than the one you govern
canonically, use `from_key` to expose the same value under a second name —
without duplicating the secret:

```toml
[secret.API_KEY]
service      = "stripe"
expires      = "2027-01-15"
rotation_url = "https://dashboard.stripe.com/apikeys"

# Same governed value, under a legacy name some consumer expects
[secret.STRIPE_SECRET_KEY]
from_key = "secret.API_KEY"
```

Both names are injected at boot, both appear in audit output, and expiration
tracking lives on the target — an alias is healthy iff its target is. Same
pattern works for `[env.*]`. Cross-type aliasing (secret → env) is rejected
at load time. See [TOML Schema → Aliases](https://envpkt.dev/reference/toml-schema/#aliases)
for the full rules.

See [`examples/`](./examples/) for more configurations.

## Sealed Packets

Sealed packets embed age-encrypted secret values directly in `envpkt.toml`. This makes your config fully self-contained — no external secrets backend needed at runtime.

> **Requires the [`age`](https://github.com/FiloSottile/age) CLI.** envpkt shells out to `age` to seal and unseal `encrypted_value` — it's a runtime dependency, not bundled, and there is **no built-in / JS fallback**. Every path that decrypts a sealed value (`boot()`, `exec`, `env export`, `env github`, the GitHub Action) needs `age` on `PATH` plus the private key.
>
> **Gotcha — partial resolution hides a missing `age`.** Plaintext `[env.*]` defaults and fnox-backed values resolve _without_ `age`, so a config can look like it's working while every sealed secret silently fails to decrypt. If sealed values aren't showing up, confirm `age` is installed — `envpkt doctor` reports its presence.

### Setup

```bash
# Generate an age keypair — writes to ~/.envpkt/<project>-key.txt and updates envpkt.toml
envpkt keygen
```

This writes `[identity]` with `name`, `recipient`, and `key_file` to your `envpkt.toml`. Add the key file to `.gitignore`:

```toml
[identity]
name = "my-agent"
recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
key_file = "~/.envpkt/my-agent-key.txt"
```

`envpkt keygen` defaults to a **project-specific path** (`~/.envpkt/<project>-key.txt`), so separate projects never collide. For multi-environment projects (e.g. `prod.envpkt.toml` + `dev.envpkt.toml`), each config gets its own key automatically. Pass `--global` to use the shared `~/.envpkt/age-key.txt` path instead.

The `key_file` path supports `~` expansion and environment variables (`$VAR`, `${VAR}`). Relative paths are resolved from the config file's directory. When omitted, envpkt falls back to `ENVPKT_AGE_KEY_FILE` env var, then `~/.envpkt/age-key.txt` — but it's best to set `key_file` explicitly so the config tells you which key it needs.

### Seal

```bash
envpkt seal
```

Each secret gets an `encrypted_value` field with age-armored ciphertext. The TOML (including ciphertext) is safe to commit.

### Boot

At runtime, sealed values are automatically decrypted:

```typescript
import { boot } from "envpkt"

const result = boot() // decrypts sealed values, injects into process.env
```

Mixed mode is supported — sealed values take priority, with fnox as fallback for keys without `encrypted_value`.

### Where it injects: self-launched vs serverless

Whether envpkt can replace a cloud secret store depends on one thing: **do you control how the process starts?**

- **You launch it** (server, container, VM, k8s, systemd) → `envpkt exec -- yourapp` or `boot()` injects the decrypted values straight into the process environment. No cloud secret store needed: the sealed `envpkt.toml` ships with the app, and only the age key has to reach the runtime (N secrets collapse to 1 key).
- **A platform launches it** (Cloudflare Workers, AWS Lambda, Vercel) → you don't own the launch, and the `age` CLI can't run inside the per-request isolate, so the platform's secret store is unavoidable. envpkt becomes the source of truth that populates and audits that store — not the injector.

> Rule of thumb: **own the launch → `exec`/`boot`, no store. Platform owns the launch → store required, envpkt feeds and audits it.** Full details: [Runtime injection guide](https://envpkt.dev/guides/runtime-injection/).

## GitHub Actions

A composite action resolves the credentials in `envpkt.toml` into the CI job — with secret values masked in the log — so later steps just see them as environment variables:

```yaml
- uses: actions/checkout@v5

# Sealed packets are decrypted with the `age` CLI (not preinstalled on runners).
- run: sudo apt-get update && sudo apt-get install -y age

- uses: jordanburke/envpkt@v0
  with:
    config: ./envpkt.toml
    strict: "true" # fail the build if a credential is expired/unhealthy
  env:
    ENVPKT_AGE_KEY: ${{ secrets.ENVPKT_AGE_KEY }}

- run: ./deploy.sh # sees the resolved vars; secret values redacted in the log
```

**How it works.** Commit sealed (`encrypted_value`) packets to the repo and supply the age private key as the `ENVPKT_AGE_KEY` secret. `boot()` materializes the inline key to a `0600` temp file to decrypt, then [`env github`](#envpkt-env-github) masks each secret (`::add-mask::`) and writes it to `$GITHUB_ENV`. Identity precedence: `identity.key_file` → `ENVPKT_AGE_KEY_FILE` → `ENVPKT_AGE_KEY` (inline) → `~/.envpkt/age-key.txt`.

**Inputs:** `config`, `version` (npm version to run, default `latest`), `strict`, `profile`.

> **The [`age`](https://github.com/FiloSottile/age) CLI is required on the runner to unseal `encrypted_value` packets** (install it first, as above) — envpkt shells out to `age`, with no bundled/JS fallback. Without it, sealed secrets won't decrypt or be injected, even though plaintext `[env.*]` defaults and fnox-backed values still resolve — which can mask the missing dependency until a sealed value turns up empty downstream. Reference `@v0` for the moving major tag (re-pointed to each `0.x` release), or pin an exact release like `@v0.13.6` for immutability. `@v1` ships when envpkt reaches 1.0. Node is assumed present; add `actions/setup-node` first to pin a version.

### Anti-rot CI gate

A hand-maintained `envpkt.toml` is documentation, and documentation rots. The fix is a failing build: each `--strict` check exits non-zero so a stale or drifted config blocks the merge. Each gate is **metadata-only** (no secret values) and targets a different failure mode — compose the ones that fit:

```bash
# 1. Secret health — runs anywhere, no live env or age key needed.
#    Fails on expired / stale (> lifecycle.stale_warning_days) / missing / missing-metadata.
envpkt audit --strict            # exit 1 = degraded, 2 = critical

# 2. Cross-environment parity — keep dev/staging/prod tracking the same keys.
envpkt diff dev.envpkt.toml prod.envpkt.toml --exit-code

# 3. Drift vs the live environment — run where the env is actually populated
#    (a deployed host or a pre-deploy step), NOT a bare CI runner: with no env
#    set, every var reads as "missing" and the gate false-fails.
envpkt env check --strict        # exit 1 on any drift (missing / untracked)
```

**Where each belongs.** `audit --strict` and `diff --exit-code` are environment-independent — drop them in any PR/CI job as a merge gate. `env check --strict` compares the config against the _live_ environment, so it belongs in a pre-deploy step or a host healthcheck, after the env is populated (e.g. `eval "$(envpkt env export)"`), not in a stock CI runner.

```yaml
# PR gate: block merges when the config rots (no secrets, no age key required)
- uses: jordanburke/envpkt@v0.13.4
  with: { config: ./envpkt.toml, strict: "true" }
- run: envpkt diff dev.envpkt.toml prod.envpkt.toml --exit-code
```

> Freshness in the sense of "verified live within N days" (a credential that still _authenticates_, not just one that hasn't _expired_ on paper) is a [verification](#) capability reserved for the hosted offering — `--strict` enforces everything checkable offline today.

## For agents and fleets

Everything above stands on its own with no agents involved. Once you _do_ have them, the same `envpkt.toml` metadata powers three more capabilities: agents reading their own constraints over MCP, fleet-wide health monitoring, and shared catalogs across many agents.

### MCP server

envpkt ships an [MCP](https://modelcontextprotocol.io/) server that gives AI agents structured awareness of their credentials. Add it to Claude, Cursor, VS Code, or any MCP-compatible client:

```json
{
  "mcpServers": {
    "envpkt": {
      "command": "envpkt",
      "args": ["mcp"]
    }
  }
}
```

**Tools**

| Tool               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `getPacketHealth`  | Get overall health status with per-secret audit results |
| `listCapabilities` | List agent and per-secret capabilities                  |
| `getSecretMeta`    | Get metadata for a specific secret by key               |
| `checkExpiration`  | Check expiration status and days remaining              |
| `getEnvMeta`       | Get metadata for environment defaults and drift status  |

**Resources**

| URI                     | Description                       |
| ----------------------- | --------------------------------- |
| `envpkt://health`       | Current credential health summary |
| `envpkt://capabilities` | Agent and secret capabilities     |

The MCP server exposes metadata only — it reads `envpkt.toml` and strips any `encrypted_value` ciphertext from responses, so prompt injection cannot leak what isn't there. See [Security Model](#security-model) for the full trust model.

## Fleet Management

When you're running multiple agents, `envpkt fleet` scans a directory tree for `envpkt.toml` files and aggregates credential health across your entire fleet.

```bash
envpkt fleet                    # Scan current directory (depth 3)
envpkt fleet -d /opt/agents     # Scan specific directory
envpkt fleet --depth 5          # Increase scan depth
envpkt fleet --format json      # JSON output
envpkt fleet --status critical  # Filter agents by health status
```

### Shared Catalog

When multiple agents consume the same secrets, a **shared catalog** prevents metadata duplication. Define secret metadata once in a central file, then have each agent reference it.

#### Catalog file (`infra/envpkt.toml`)

```toml
version = 1

[lifecycle]
stale_warning_days = 90
require_expiration = true

[secret.DATABASE_URL]
service = "postgres"
purpose = "Primary application database"
capabilities = ["SELECT", "INSERT", "UPDATE", "DELETE"]
rotation_url = "https://wiki.internal/runbooks/rotate-db"
source = "vault"
created = "2025-11-01"
expires = "2026-11-01"

[secret.REDIS_URL]
service = "redis"
purpose = "Caching and session storage"
created = "2025-11-01"
expires = "2026-11-01"
```

#### Agent file (`agents/pipeline/envpkt.toml`)

```toml
version = 1
catalog = "../../infra/envpkt.toml"

[identity]
name = "data-pipeline"
consumer = "agent"
secrets = ["DATABASE_URL", "REDIS_URL"]

# Optional: narrow the catalog definition for this agent
[secret.DATABASE_URL]
capabilities = ["SELECT"]
```

#### Resolve to a flat config

```bash
envpkt resolve -c agents/pipeline/envpkt.toml
```

This produces a self-contained config with catalog metadata merged in and agent overrides applied. The resolved output has no `catalog` reference — it's ready for deployment.

#### Merge rules

- Each field in the agent's `[secret.KEY]` override **replaces** the catalog field (shallow merge)
- Omitted fields keep the catalog value
- `identity.secrets` is the source of truth for which keys the agent needs

## How envpkt Compares

The agentic credential space is splitting into approaches. Here's where envpkt fits:

|                             | envpkt                                                      | agent-vault                 | AgentSecrets               | 1Password Agentic             | Infisical            |
| --------------------------- | ----------------------------------------------------------- | --------------------------- | -------------------------- | ----------------------------- | -------------------- |
| **Core approach**           | Metadata sidecar                                            | Git-based secret storage    | Proxy injection            | Browser autofill              | Secret retrieval API |
| **What agents see**         | Structured metadata (capabilities, constraints, expiration) | Raw secret values           | Nothing (proxy handles it) | Nothing (autofill handles it) | Raw secret values    |
| **MCP server**              | Yes                                                         | Yes                         | No                         | No                            | Yes                  |
| **Encryption at rest**      | age sealed packets                                          | Git-crypt                   | N/A (proxy model)          | Vault encryption              | Vault encryption     |
| **Per-agent scoping**       | Yes (identity.secrets, capabilities)                        | Yes (policies)              | Yes (proxy rules)          | No                            | Yes (policies)       |
| **Fleet health monitoring** | Yes (fleet scan, aggregated audit)                          | No                          | No                         | No                            | No                   |
| **Credential metadata**     | Rich (purpose, capabilities, rotation, lifecycle)           | Minimal                     | Minimal                    | Minimal                       | Moderate             |
| **Adoption path**           | Scan existing env vars, add metadata incrementally          | New secret storage workflow | Proxy configuration        | Browser extension             | API integration      |

**envpkt's angle**: Competitors are fighting over how secrets move — retrieval vs. proxy vs. autofill. envpkt owns what secrets _mean_. Rate limits, expiration policies, capability scopes, rotation runbooks — structured semantics that travel with the credential. That's the layer the others don't have.

> **Note**: This comparison reflects publicly available information. Verify current feature sets before making procurement decisions.

## CLI Reference

### `envpkt init`

Generate an `envpkt.toml` template in the current directory.

```bash
envpkt init                                    # Basic template
envpkt init --from-fnox                        # Scaffold from fnox.toml
envpkt init --identity --name "my-agent"        # Include identity section
envpkt init --catalog "../infra/envpkt.toml"   # Reference a shared catalog
envpkt init --identity --name "bot" --capabilities "read,write" --expires "2027-01-01"
```

### `envpkt audit`

Check credential health against lifecycle policies. Automatically resolves catalog references.

```bash
envpkt audit                        # Table output
envpkt audit --format json          # JSON output
envpkt audit --expiring 14          # Show secrets expiring within 14 days
envpkt audit --status expired       # Filter by status
envpkt audit --strict               # Exit non-zero on any non-healthy secret
envpkt audit -c path/to/envpkt.toml # Specify config path
```

Exit codes: `0` = healthy, `1` = degraded, `2` = critical.

### `envpkt doctor`

One-shot environment check: is the `age` CLI installed, is a config resolvable here, and do its sealed secrets decrypt with an available key?

```bash
envpkt doctor
# ✓ age      v1.2.0
# ✓ config   /path/to/envpkt.toml
# ✓ secrets  5 resolved, 0 skipped
```

If `age` is missing it prints the platform-specific install command; if a sealed packet has no key, it lists the paths it searched. Exits non-zero when a check fails.

### `envpkt resolve`

Resolve catalog references and output a flat, self-contained config.

```bash
envpkt resolve -c agent.toml                # Output resolved TOML to stdout
envpkt resolve -c agent.toml --format json  # Output as JSON
envpkt resolve -c agent.toml -o resolved.toml  # Write to file
envpkt resolve -c agent.toml --dry-run      # Preview without writing
```

Configs without a `catalog` field pass through unchanged.

### `envpkt inspect`

Display a structured view of an `envpkt.toml` file. Automatically resolves catalog references.

```bash
envpkt inspect                        # Current directory
envpkt inspect -c path/to/envpkt.toml # Specific file
envpkt inspect --format json          # Raw JSON dump
envpkt inspect --resolved             # Show resolved view (catalog merged)
envpkt inspect --secrets              # Show secret values from env (masked)
envpkt inspect --secrets --plaintext  # Show secret values in plaintext
```

The `--secrets` flag reads values from environment variables matching each secret key. By default values are masked (`pos•••••yapp`). Add `--plaintext` to display full values.

### `envpkt diff`

Compare two configs — useful for spotting drift between environments (e.g. `dev.envpkt.toml` vs `prod.envpkt.toml`). Reports keys only in each side and field-level metadata changes for shared keys. Sealed ciphertext is ignored (the same secret re-encrypts differently); a sealed↔unsealed change is reported.

```bash
envpkt diff dev.envpkt.toml prod.envpkt.toml
# - dev.envpkt.toml
# + prod.envpkt.toml
#
# [secret]
#   - OLD_KEY
#   + NEW_KEY
#   ~ API_KEY
#       expires: 2026-01-01 → 2027-01-01

envpkt diff a.toml b.toml --format json   # structured diff
envpkt diff a.toml b.toml --exit-code     # exit non-zero on any difference (CI drift gate)
```

### `envpkt copy`

Copy a secret or env entry from one config to another. For a sealed secret, the value is unsealed with the **source's** age key and resealed for the **destination's** `identity.recipient` automatically — so you can move a credential between configs that use different keys without ever handling the plaintext yourself. Env entries (and secrets with no sealed value) copy as metadata only. The kind (secret vs env) is detected from where the key lives in the source.

```bash
envpkt copy DATABASE_URL --from prod.envpkt.toml --to staging.envpkt.toml
envpkt copy DATABASE_URL --from prod.envpkt.toml --to staging.envpkt.toml --as DB_URL  # rename on copy
envpkt copy PORT --to other.envpkt.toml          # --from defaults to the resolved config here
envpkt copy API_KEY --to b.toml --force          # overwrite if it already exists in the destination
envpkt copy API_KEY --to b.toml --dry-run        # preview without writing
```

`--from`/`--to` default to the config resolved for the current directory (and must already exist). On copy, `created` is reset to today and `last_rotated_at` is dropped (it's the source's rotation history). Copying a sealed secret needs the source key to unseal and the destination's `identity.recipient` to reseal.

### `envpkt exec`

Run a pre-flight audit, inject secrets from fnox into the environment, then execute a command.

```bash
envpkt exec -- node server.js         # Audit then run
envpkt exec --skip-audit -- npm start # Skip the audit
envpkt exec --strict -- ./deploy.sh   # Abort if audit is not healthy
envpkt exec --profile staging -- ...  # Use a specific fnox profile
```

### `envpkt seal`

Encrypt secret values into `envpkt.toml` using [age](https://age-encryption.org/). Sealed values are safe to commit to git — only the holder of the private key can decrypt them.

```bash
envpkt seal                            # Seal all secrets in envpkt.toml
envpkt seal -c path/to/envpkt.toml     # Specify config path
envpkt seal --profile staging          # Use a specific fnox profile for value resolution
```

Requires `identity.recipient` (age public key) in your config. Values are resolved via cascade:

1. **fnox** (if available)
2. **Environment variables** (e.g. `OPENAI_API_KEY` in your shell)
3. **Interactive prompt** (asks you to paste each value)

After sealing, each secret gets an `encrypted_value` field. At boot time, `envpkt exec` or `boot()` automatically decrypts sealed values using the `identity.key_file` path (or the default `~/.envpkt/age-key.txt`).

See [`examples/sealed-agent.toml`](./examples/sealed-agent.toml) for a complete example.

### `envpkt env scan`

Auto-discover credentials from your shell environment. Matches env vars against ~45 known services (exact name), ~13 generic suffix patterns (`*_API_KEY`, `*_SECRET`, `*_TOKEN`, etc.), and ~29 value shape patterns (`sk-*`, `ghp_*`, `AKIA*`, `postgres://`, etc.).

```bash
envpkt env scan                     # Table output with confidence icons
envpkt env scan --format json       # JSON output
envpkt env scan --write             # Write/append to envpkt.toml
envpkt env scan --dry-run           # Preview TOML that would be written
envpkt env scan --include-unknown   # Include vars with no inferred service
```

Confidence levels:

- **High** (●) — exact name match or recognized value prefix
- **Medium** (◐) — generic suffix pattern with derived service name

### `envpkt env check`

Bidirectional drift detection between `envpkt.toml` and the live shell environment. Checks both directions: TOML keys missing from env, and credential-shaped env vars not tracked in TOML.

```bash
envpkt env check                        # Table output
envpkt env check --format json          # JSON output
envpkt env check --strict               # Exit non-zero on any drift
envpkt env check -c path/to/envpkt.toml # Specify config path
```

### `envpkt env export`

Output `export KEY='VALUE'` statements for sourcing secrets into the current shell. Secrets are resolved via sealed packets and/or fnox — the same pipeline as `envpkt exec`, but instead of spawning a subprocess, the output is designed to be `eval`'d.

```bash
# Source secrets into the current shell
eval "$(envpkt env export)"

# Use a specific fnox profile
eval "$(envpkt env export --profile staging)"

# Specify config path
eval "$(envpkt env export -c path/to/envpkt.toml)"
```

Add to your shell startup (e.g. `~/.zshrc`) to load a global package once at login:

```bash
eval "$(envpkt env export 2>/dev/null)"
```

Secret values are emitted **only when the package sets top-level `scope = "shell"`** — the default `scope = "exec"` withholds them (use `envpkt exec`). For **per-project** credentials that load on `cd`, use [`envpkt shell-hook`](#envpkt-shell-hook) rather than a one-time startup eval.

### `envpkt shell-hook`

Generate a `cd` hook (zsh/bash) that loads a project's credentials when you enter its directory tree and restores your environment when you leave:

```bash
eval "$(envpkt shell-hook zsh)"             # add to ~/.zshrc (or: shell-hook bash)
eval "$(envpkt shell-hook zsh --no-audit)"  # …without the per-cd health-check line
```

On each directory change it resolves the **nearest `envpkt.toml`, walking up from the current directory** (like `git`/`direnv` — so it works from any subdirectory, not just the project root), injects that package via `env export --track`, and restores the previous package on leave (prior values, not a blind unset). Env defaults always load; secret values load only for `scope = "shell"` packages. Backed by `envpkt config-path` — a resolve-only command that prints the active config path (no decryption).

> **Upward-walk discovery**: config resolution now walks up the directory tree to the nearest `envpkt.toml` before falling back to the global package. This also applies to `exec`, `env export`, and `audit` — running any of them from a subdirectory finds the enclosing project.

### `envpkt env github`

Inject resolved secrets into a GitHub Actions job. Emits `::add-mask::` for each secret value (redacting it from the log) and appends assignments to `$GITHUB_ENV` — under their namespaced wire names — so later steps in the job inherit them. Env defaults are written but not masked. `--strict` exits non-zero if the pre-flight audit is unhealthy. This is the engine behind the [GitHub Action](#github-actions).

```bash
# Run as a step; later steps in the job see the resolved vars
npx envpkt env github --strict
```

### `envpkt mcp`

Start the envpkt MCP server (stdio transport) for AI agent integration.

```bash
envpkt mcp
```

## Config Resolution

Commands that read `envpkt.toml` resolve the config path via a priority chain:

1. **Explicit flag** — `-c path/to/envpkt.toml`
2. **Environment variable** — `ENVPKT_CONFIG`
3. **Discovery chain** — searches in order:
   - `./envpkt.toml` (current working directory)
   - Custom paths in `ENVPKT_SEARCH_PATH` (colon-separated)
   - `~/.envpkt/envpkt.toml` (user home)
   - Cloud storage paths (OneDrive, iCloud, Dropbox, Google Drive)

When a config is discovered outside CWD, envpkt prints where it loaded from to stderr:

```
envpkt: loaded /Users/you/.envpkt/envpkt.toml
```

### `ENVPKT_SEARCH_PATH`

Prepend custom search locations (colon-separated paths to `envpkt.toml` files):

```bash
export ENVPKT_SEARCH_PATH="$HOME/OneDrive/.envpkt/envpkt.toml:/custom/path/envpkt.toml"
```

These are searched after CWD but before the built-in candidate paths. Useful for corporate OneDrive names, Google Drive with email in the path, or any non-standard location.

## Library API

envpkt is also available as a TypeScript library with a functional programming API built on [functype](https://github.com/jordanburke/functype). All functions return `Either<Error, Result>` or `Option<T>` — no thrown exceptions.

```typescript
import { boot, bootSafe, loadConfig, computeAudit, scanFleet, resolveConfig } from "envpkt"

// Boot API — load config, resolve catalog, audit, inject secrets
const result = boot({ configPath: "envpkt.toml", inject: true })
console.log(result.audit.status) // "healthy" | "degraded" | "critical"
console.log(result.configSource) // "flag" | "env" | "cwd" | "search"

// Safe variant returns Either instead of throwing
const safe = bootSafe({ configPath: "envpkt.toml" })
safe.fold(
  (err) => console.error("Boot failed:", err._tag),
  (result) => console.log(`${result.injected.length} secrets injected`),
)

// Load and audit directly
const config = loadConfig("envpkt.toml")
config.fold(
  (err) => console.error("Failed:", err._tag),
  (config) => {
    const audit = computeAudit(config)
    audit.secrets.forEach((s) => {
      s.days_remaining.fold(
        () => console.log(`${s.key}: no expiration set`),
        (days) => console.log(`${s.key}: ${days} days remaining`),
      )
    })
  },
)

// Fleet scan
const fleet = scanFleet("/opt/agents", { maxDepth: 3 })
console.log(`${fleet.total_agents} agents, ${fleet.total_secrets} secrets`)
```

### Framework Integration

`boot()` runs before your agent framework initializes, making it compatible with any framework:

```typescript
import { boot } from "envpkt"

// Resolve and inject credentials before agent startup
const result = boot({ configPath: "envpkt.toml", inject: true })
console.log(`${result.audit.status} — ${result.injected.length} secrets loaded`)

// Now start your agent framework — process.env is populated
// Works with LangChain, CrewAI, AutoGen, or any framework that reads from process.env
```

### Packet Formatting API

```typescript
import { formatPacket, maskValue } from "envpkt"

// formatPacket produces a human-readable text summary of a resolved config
const text = formatPacket(resolveResult)

// With secret values (masked by default)
const masked = formatPacket(resolveResult, {
  secrets: { DATABASE_URL: "postgres://user:pass@host/db" },
})
// DATABASE_URL → postgres = pos•••••t/db

// With plaintext secret values
const plain = formatPacket(resolveResult, {
  secrets: { DATABASE_URL: "postgres://user:pass@host/db" },
  secretDisplay: "plaintext",
})
```

### Environment Scan/Check API

```typescript
import { envScan, envCheck, generateTomlFromScan, matchEnvVar } from "envpkt"

// Scan process.env for credentials
const scan = envScan(process.env)
console.log(`Found ${scan.discovered.size} credentials (${scan.high_confidence} high confidence)`)

scan.discovered.forEach((m) => {
  const svc = m.service.fold(
    () => "unknown",
    (s) => s,
  )
  console.log(`  ${m.envVar} → ${svc} (${m.confidence})`)
})

// Generate TOML blocks from scan results
const toml = generateTomlFromScan(scan.discovered.toArray())

// Check drift between config and live env
import { loadConfig } from "envpkt"

loadConfig("envpkt.toml").fold(
  (err) => console.error(err),
  (config) => {
    const check = envCheck(config, process.env)
    if (!check.is_clean) {
      console.log(`${check.missing_from_env} missing, ${check.untracked_credentials} untracked`)
    }
  },
)

// Match a single env var
matchEnvVar("OPENAI_API_KEY", "sk-test123").fold(
  () => console.log("Not a credential"),
  (m) => console.log(`Matched: ${m.confidence} confidence`),
)
```

### Seal API

```typescript
import { ageEncrypt, ageDecrypt, sealSecrets, unsealSecrets } from "envpkt"

// Encrypt a single value
const encrypted = ageEncrypt("sk-my-api-key", "age1ql3z7hjy...")
encrypted.fold(
  (err) => console.error("Encrypt failed:", err.message),
  (ciphertext) => console.log(ciphertext), // -----BEGIN AGE ENCRYPTED FILE-----
)

// Decrypt a single value
const decrypted = ageDecrypt(ciphertext, "/path/to/identity.txt")

// Seal all secrets in a config's meta
const sealed = sealSecrets(config.meta, { OPENAI_API_KEY: "sk-..." }, recipientPublicKey)

// Unseal all encrypted_value entries
const values = unsealSecrets(config.meta, "/path/to/identity.txt")
values.fold(
  (err) => console.error("Unseal failed:", err.message),
  (secrets) => console.log(secrets), // { OPENAI_API_KEY: "sk-..." }
)
```

### Catalog Resolution API

```typescript
import { loadConfig, resolveConfig } from "envpkt"
import { dirname } from "node:path"

const configPath = "agents/pipeline/envpkt.toml"
loadConfig(configPath).fold(
  (err) => console.error(err),
  (config) => {
    resolveConfig(config, dirname(configPath)).fold(
      (err) => console.error("Catalog error:", err._tag),
      (result) => {
        console.log("Resolved keys:", result.merged)
        console.log("Overridden:", result.overridden)
        // result.config is the flat, self-contained config
      },
    )
  },
)
```

## Schema

envpkt.toml is validated against a JSON Schema. Editors with TOML + JSON Schema support will provide autocompletion and validation when the `#:schema` directive is present on line 1.

The schema is published at:

- npm: `envpkt/schema` (importable via package exports)
- GitHub: `schemas/envpkt.schema.json`

### Secret Metadata Fields

Each `[secret.<KEY>]` section describes a secret:

| Tier            | Fields                                          | Description                                 |
| --------------- | ----------------------------------------------- | ------------------------------------------- |
| **Scan-first**  | `service`, `expires`, `rotation_url`            | Key health indicators for audit             |
| **Context**     | `purpose`, `comment`, `capabilities`, `created` | Why this secret exists and what it grants   |
| **Operational** | `rotates`, `rate_limit`, `model_hint`, `source` | Runtime and provisioning info               |
| **Sealed**      | `encrypted_value`                               | Age-encrypted secret value (safe to commit) |
| **Enforcement** | `required`, `tags`                              | Filtering, grouping, and policy             |

### Identity

The optional `[identity]` section identifies the consumer of these credentials:

```toml
[identity]
name = "data-pipeline-agent"
consumer = "agent"                     # agent | service | developer | ci
description = "ETL pipeline processor"
capabilities = ["read-s3", "write-postgres"]
expires = "2027-01-01"
services = ["aws", "postgres"]
secrets = ["DATABASE_URL", "AWS_KEY"]  # When using a catalog
```

### Lifecycle Policy

The optional `[lifecycle]` section configures audit behavior:

```toml
[lifecycle]
stale_warning_days = 90       # Flag secrets older than N days without updates
require_expiration = true     # Require expires on all secrets
require_service = true        # Require service on all secrets
```

## fnox Integration

envpkt integrates with [fnox](https://github.com/jordanburke/fnox) for secret resolution:

- `envpkt init --from-fnox` scaffolds `[secret.*]` entries from `fnox.toml`
- `envpkt audit` detects orphaned keys (in envpkt but not in fnox, or vice versa)
- `envpkt exec` injects fnox secrets into the subprocess environment

## Development

```bash
pnpm install
pnpm validate    # format + lint + typecheck + test + build:schema + build
pnpm test        # Run tests only
pnpm dev         # Watch mode
pnpm demo        # Regenerate demo HTML renders in examples/demo/
```

See [`examples/demo/`](./examples/demo/) for a walkthrough of the catalog system with 3 agents, including styled HTML renders of the inspect output in all 3 display modes (no secrets, masked, plaintext).

## License

Apache-2.0
