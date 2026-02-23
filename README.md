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

envpkt never touches secret values. It works alongside your existing secrets manager (Vault, fnox, CI variables, etc.).

## Quick Start

```bash
# Install
npm install -g envpkt

# Initialize in your project
envpkt init

# Audit credential health
envpkt audit

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
role = "payment-processor"
capabilities = ["charge", "refund"]

[lifecycle]
warn_before_days = 14
stale_after_days = 365

[meta.STRIPE_SECRET_KEY]
service = "stripe"
consumer = "api"
env_var = "STRIPE_SECRET_KEY"
purpose = "Process customer payments and manage subscriptions"
capabilities = ["charges:write", "subscriptions:write"]
created = "2026-01-15"
expires = "2027-01-15"
rotation_url = "https://dashboard.stripe.com/apikeys"
provisioner = "manual"
tags = ["payments", "production"]

[meta.DATABASE_URL]
service = "postgres"
consumer = "database"
env_var = "DATABASE_URL"
purpose = "Read/write access to the billing database"
capabilities = ["SELECT", "INSERT", "UPDATE"]
created = "2026-02-01"
expires = "2026-08-01"
rotation_url = "https://wiki.internal/runbooks/rotate-db-creds"
provisioner = "vault"
tags = ["postgres", "production"]
```

See [`examples/`](./examples/) for more configurations.

## CLI Commands

### `envpkt init`

Generate an `envpkt.toml` template in the current directory.

```bash
envpkt init                                    # Basic template
envpkt init --from-fnox                        # Scaffold from fnox.toml
envpkt init --agent --name "my-agent"          # Include agent identity
envpkt init --agent --name "bot" --capabilities "read,write" --expires "2027-01-01"
```

### `envpkt audit`

Check credential health against lifecycle policies.

```bash
envpkt audit                        # Table output
envpkt audit --format json          # JSON output
envpkt audit --expiring 14          # Show secrets expiring within 14 days
envpkt audit --status expired       # Filter by status
envpkt audit --strict               # Exit non-zero on any non-healthy secret
envpkt audit -c path/to/envpkt.toml # Specify config path
```

Exit codes: `0` = healthy, `1` = degraded, `2` = critical.

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

Display a structured view of an `envpkt.toml` file.

```bash
envpkt inspect                        # Current directory
envpkt inspect -c path/to/envpkt.toml # Specific file
envpkt inspect --format json          # Raw JSON dump
```

### `envpkt exec`

Run a pre-flight audit, inject secrets from fnox into the environment, then execute a command.

```bash
envpkt exec -- node server.js         # Audit then run
envpkt exec --skip-audit -- npm start # Skip the audit
envpkt exec --strict -- ./deploy.sh   # Abort if audit is not healthy
envpkt exec --profile staging -- ...  # Use a specific fnox profile
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

Each `[meta.<KEY>]` section answers five questions:

| Question  | Fields                        | Description                                 |
| --------- | ----------------------------- | ------------------------------------------- |
| **What**  | `service`, `consumer`         | What service and what type of integration   |
| **Where** | `env_var`, `vault_path`       | Where the secret is injected and stored     |
| **Why**   | `purpose`, `capabilities`     | Why the secret exists and what it grants    |
| **When**  | `created`, `expires`          | When it was provisioned and when it expires |
| **How**   | `provisioner`, `rotation_url` | How it's provisioned and how to rotate it   |

### Agent Identity

The optional `[agent]` section identifies the AI agent:

```toml
[agent]
name = "data-pipeline-agent"
role = "etl-processor"
capabilities = ["read-s3", "write-postgres"]
expires = "2027-01-01"
```

### Lifecycle Policy

The optional `[lifecycle]` section configures audit behavior:

```toml
[lifecycle]
warn_before_days = 30        # Warn N days before expiration
stale_after_days = 365       # Flag secrets older than N days
require_rotation_url = true  # Require rotation_url on all secrets
require_purpose = true       # Require purpose on all secrets
```

## Library API

envpkt is also available as a TypeScript library with a functional programming API built on [functype](https://github.com/jordanburke/functype). All functions return `Either<Error, Result>` or `Option<T>` — no thrown exceptions.

```typescript
import { loadConfig, computeAudit, scanFleet } from "envpkt"

// Load and validate config
const result = loadConfig("envpkt.toml")
result.fold(
  (err) => console.error("Failed:", err._tag),
  (config) => {
    // Run audit
    const audit = computeAudit(config)
    console.log(audit.status) // "healthy" | "degraded" | "critical"

    // Check individual secrets
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
```

## License

Apache-2.0
