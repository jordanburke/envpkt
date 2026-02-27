# envpkt

[![Node.js CI](https://github.com/jordanburke/envpkt/actions/workflows/node.js.yml/badge.svg)](https://github.com/jordanburke/envpkt/actions/workflows/node.js.yml)
[![npm version](https://img.shields.io/npm/v/envpkt.svg)](https://www.npmjs.com/package/envpkt)

Credential lifecycle and fleet management for AI agents.

**fnox handles access. envpkt handles awareness.** One file (`envpkt.toml`) answers five questions per credential: **What / Where / Why / When / How**.

## Why envpkt?

Secrets managers store values. envpkt stores _metadata about_ those values — what service each credential authenticates to, when it expires, how to rotate it, and why it exists. This gives AI agents (and their operators) a structured way to:

- Audit credential health across a fleet of agents
- Get warnings before secrets expire
- Detect stale or orphaned credentials
- Understand what capabilities each secret grants
- Automate rotation workflows
- Share secret metadata across agents via a central catalog

envpkt never touches secret values. It works alongside your existing secrets manager (Vault, fnox, CI variables, etc.).

## Quick Start

```bash
# Install
npm install -g envpkt

# Auto-discover credentials from your shell environment
envpkt env scan

# Scaffold envpkt.toml from discovered credentials
envpkt env scan --write

# Audit credential health
envpkt audit

# Check for drift between envpkt.toml and live environment
envpkt env check

# Scan a directory tree of agents
envpkt fleet
```

## The envpkt.toml File

Every project gets one `envpkt.toml` that describes its credentials. Here's a minimal example:

```toml
#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json

version = 1

[meta.API_KEY]
service = "stripe"
```

And a more complete one:

```toml
#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json

version = 1

[agent]
name = "billing-service"
consumer = "agent"
description = "Payment processing agent"
capabilities = ["charge", "refund"]
expires = "2027-01-01"

[lifecycle]
stale_warning_days = 90
require_expiration = true
require_service = true

[meta.STRIPE_SECRET_KEY]
service = "stripe"
purpose = "Process customer payments and manage subscriptions"
capabilities = ["charges:write", "subscriptions:write"]
created = "2026-01-15"
expires = "2027-01-15"
rotation_url = "https://dashboard.stripe.com/apikeys"
source = "vault"

[meta.DATABASE_URL]
service = "postgres"
purpose = "Read/write access to the billing database"
capabilities = ["SELECT", "INSERT", "UPDATE"]
created = "2026-02-01"
expires = "2026-08-01"
rotation_url = "https://wiki.internal/runbooks/rotate-db-creds"
source = "vault"
```

See [`examples/`](./examples/) for more configurations.

## Shared Secret Catalog

When multiple agents consume the same secrets, a **shared catalog** prevents metadata duplication. Define secret metadata once in a central file, then have each agent reference it.

### Catalog file (`infra/envpkt.toml`)

```toml
version = 1

[lifecycle]
stale_warning_days = 90
require_expiration = true

[meta.DATABASE_URL]
service = "postgres"
purpose = "Primary application database"
capabilities = ["SELECT", "INSERT", "UPDATE", "DELETE"]
rotation_url = "https://wiki.internal/runbooks/rotate-db"
source = "vault"
created = "2025-11-01"
expires = "2026-11-01"

[meta.REDIS_URL]
service = "redis"
purpose = "Caching and session storage"
created = "2025-11-01"
expires = "2026-11-01"
```

### Agent file (`agents/pipeline/envpkt.toml`)

```toml
version = 1
catalog = "../../infra/envpkt.toml"

[agent]
name = "data-pipeline"
consumer = "agent"
secrets = ["DATABASE_URL", "REDIS_URL"]

# Optional: narrow the catalog definition for this agent
[meta.DATABASE_URL]
capabilities = ["SELECT"]
```

### Resolve to a flat config

```bash
envpkt resolve -c agents/pipeline/envpkt.toml
```

This produces a self-contained config with catalog metadata merged in and agent overrides applied. The resolved output has no `catalog` reference — it's ready for deployment.

### Merge rules

- Each field in the agent's `[meta.KEY]` override **replaces** the catalog field (shallow merge)
- Omitted fields keep the catalog value
- `agent.secrets` is the source of truth for which keys the agent needs

## CLI Commands

### `envpkt init`

Generate an `envpkt.toml` template in the current directory.

```bash
envpkt init                                    # Basic template
envpkt init --from-fnox                        # Scaffold from fnox.toml
envpkt init --agent --name "my-agent"          # Include agent identity
envpkt init --catalog "../infra/envpkt.toml"   # Reference a shared catalog
envpkt init --agent --name "bot" --capabilities "read,write" --expires "2027-01-01"
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

### `envpkt resolve`

Resolve catalog references and output a flat, self-contained config.

```bash
envpkt resolve -c agent.toml                # Output resolved TOML to stdout
envpkt resolve -c agent.toml --format json  # Output as JSON
envpkt resolve -c agent.toml -o resolved.toml  # Write to file
envpkt resolve -c agent.toml --dry-run      # Preview without writing
```

Configs without a `catalog` field pass through unchanged.

### `envpkt fleet`

Scan a directory tree for `envpkt.toml` files and aggregate health.

```bash
envpkt fleet                    # Scan current directory (depth 3)
envpkt fleet -d /opt/agents     # Scan specific directory
envpkt fleet --depth 5          # Increase scan depth
envpkt fleet --format json      # JSON output
envpkt fleet --status critical  # Filter agents by health status
```

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

### `envpkt exec`

Run a pre-flight audit, inject secrets from fnox into the environment, then execute a command.

```bash
envpkt exec -- node server.js         # Audit then run
envpkt exec --skip-audit -- npm start # Skip the audit
envpkt exec --strict -- ./deploy.sh   # Abort if audit is not healthy
envpkt exec --profile staging -- ...  # Use a specific fnox profile
```

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

### `envpkt shell-hook`

Output a shell function that runs `envpkt audit --format minimal` whenever you `cd` into a directory containing `envpkt.toml`.

```bash
# Add to your .zshrc
eval "$(envpkt shell-hook zsh)"

# Add to your .bashrc
eval "$(envpkt shell-hook bash)"
```

### `envpkt mcp`

Start the envpkt MCP server (stdio transport) for AI agent integration.

```bash
envpkt mcp
```

## MCP Server

envpkt ships an [MCP](https://modelcontextprotocol.io/) server that exposes credential metadata to AI agents. Add it to your MCP client config:

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

### Tools

| Tool               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `getPacketHealth`  | Get overall health status with per-secret audit results |
| `listCapabilities` | List agent and per-secret capabilities                  |
| `getSecretMeta`    | Get metadata for a specific secret by key               |
| `checkExpiration`  | Check expiration status and days remaining              |

### Resources

| URI                     | Description                       |
| ----------------------- | --------------------------------- |
| `envpkt://health`       | Current credential health summary |
| `envpkt://capabilities` | Agent and secret capabilities     |

No secret values are ever exposed through the MCP server.

## Schema

envpkt.toml is validated against a JSON Schema. Editors with TOML + JSON Schema support will provide autocompletion and validation when the `#:schema` directive is present on line 1.

The schema is published at:

- npm: `envpkt/schema` (importable via package exports)
- GitHub: `schemas/envpkt.schema.json`

### Secret Metadata Fields

Each `[meta.<KEY>]` section describes a secret:

| Tier            | Fields                                          | Description                               |
| --------------- | ----------------------------------------------- | ----------------------------------------- |
| **Scan-first**  | `service`, `expires`, `rotation_url`            | Key health indicators for audit           |
| **Context**     | `purpose`, `capabilities`, `created`            | Why this secret exists and what it grants |
| **Operational** | `rotates`, `rate_limit`, `model_hint`, `source` | Runtime and provisioning info             |
| **Enforcement** | `required`, `tags`                              | Filtering, grouping, and policy           |

### Agent Identity

The optional `[agent]` section identifies the AI agent:

```toml
[agent]
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

## Library API

envpkt is also available as a TypeScript library with a functional programming API built on [functype](https://github.com/jordanburke/functype). All functions return `Either<Error, Result>` or `Option<T>` — no thrown exceptions.

```typescript
import { boot, bootSafe, loadConfig, computeAudit, scanFleet, resolveConfig } from "envpkt"

// Boot API — load config, resolve catalog, audit, inject secrets
const result = boot({ configPath: "envpkt.toml", inject: true })
console.log(result.audit.status) // "healthy" | "degraded" | "critical"

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

## fnox Integration

envpkt integrates with [fnox](https://github.com/jordanburke/fnox) for secret resolution:

- `envpkt init --from-fnox` scaffolds `[meta.*]` entries from `fnox.toml`
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
