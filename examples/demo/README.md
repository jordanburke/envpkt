# envpkt Demo: Agent + Catalog Walkthrough

This demo shows how a team organizes a fleet of agents sharing a central secret catalog.

## Structure

```
demo/
  infra/
    envpkt.toml                  # Shared catalog — 4 secrets, lifecycle policy
  agents/
    data-pipeline/envpkt.toml    # Catalog agent — read-only DB + Redis
    api-gateway/envpkt.toml      # Catalog agent — full CRUD DB + Stripe
    monitoring/envpkt.toml       # Standalone agent — has expired secret
```

## Walkthrough

All commands run from the repo root.

### 1. Inspect the shared catalog

```bash
npx envpkt inspect -c examples/demo/infra/envpkt.toml
```

Shows all 4 secrets with their services, capabilities, and lifecycle metadata.

### 2. Inspect a catalog-referencing agent

```bash
npx envpkt inspect -c examples/demo/agents/data-pipeline/envpkt.toml
```

Shows the agent identity, its `catalog` reference, and which secrets it requests.

### 3. Resolve agents — flatten catalog into self-contained config

```bash
# Data pipeline gets DATABASE_URL narrowed to SELECT-only
npx envpkt resolve -c examples/demo/agents/data-pipeline/envpkt.toml

# API gateway inherits full catalog capabilities
npx envpkt resolve -c examples/demo/agents/api-gateway/envpkt.toml

# Resolve as JSON for programmatic use
npx envpkt resolve -c examples/demo/agents/data-pipeline/envpkt.toml --format json
```

Compare the two resolved outputs — `data-pipeline` gets `["SELECT"]` for DATABASE_URL while `api-gateway` gets `["SELECT", "INSERT", "UPDATE", "DELETE"]`.

### 4. Audit credential health

```bash
# Clean — all secrets valid
npx envpkt audit -c examples/demo/agents/data-pipeline/envpkt.toml

# Warning — DATADOG_API_KEY expired 2026-01-01
npx envpkt audit -c examples/demo/agents/monitoring/envpkt.toml
```

### 5. Fleet scan

```bash
npx envpkt fleet -d examples/demo/agents/
```

Scans all agents and produces an aggregate health report.

### 6. Secret Display Modes

```bash
# Metadata only — no secret values shown
npx envpkt inspect -c examples/demo/agents/api-gateway/envpkt.toml

# Masked values — first 3 + ••••• + last 4 characters
npx envpkt inspect -c examples/demo/agents/api-gateway/envpkt.toml --secrets

# Full plaintext values
npx envpkt inspect -c examples/demo/agents/api-gateway/envpkt.toml --secrets --plaintext
```

The `--secrets` flag reads values from environment variables. The demo HTML renders below use fake values for illustration.

## HTML Renders

Pre-rendered terminal screenshots showing all 3 agents across the 3 display modes:

- `inspect-no-secrets.html` — metadata only (no secret values)
- `inspect-encrypted.html` — masked values (default `--secrets` behavior)
- `inspect-plaintext.html` — full values (`--secrets --plaintext`)

Regenerate after changing fixtures or formatting:

```bash
pnpm demo
```

> Secret values in the HTML renders are fake demo data — not real credentials.

### 7. Sealed Packets (encrypted values in TOML)

Sealed packets embed age-encrypted secret values directly in the TOML, making configs fully self-contained and safe to commit to git.

#### Setup

```bash
# Generate a keypair
age-keygen -o examples/demo/agents/api-gateway/identity.txt

# Note the public key printed (age1...)
```

#### Example config with sealed secrets

See [`examples/sealed-agent.toml`](../sealed-agent.toml) for a full example. The key fields are:

```toml
[agent]
name = "my-agent"
recipient = "age1..."    # Public key — safe to commit
identity = "identity.txt" # Private key path — add to .gitignore
```

#### Seal values

```bash
# Seal secrets into the TOML (resolves values from fnox → env → prompt)
envpkt seal -c examples/sealed-agent.toml
```

After sealing, each secret gets an `encrypted_value` field:

```toml
[secret.OPENAI_API_KEY]
service = "openai"
encrypted_value = """
-----BEGIN AGE ENCRYPTED FILE-----
YWdlLWVuY3J5cHRpb24...
-----END AGE ENCRYPTED FILE-----
"""
```

#### Boot with sealed values

```bash
# Sealed values are auto-decrypted at boot — no fnox needed
envpkt exec -c examples/sealed-agent.toml -- node app.js
```

Or in code:

```typescript
import { boot } from "envpkt"
const result = boot({ configPath: "envpkt.toml" })
// Sealed values decrypted and injected into process.env
```

#### Inspect sealed config

```bash
envpkt inspect -c examples/sealed-agent.toml
# Shows [sealed] indicator next to secrets with encrypted_value
```

## Key Concepts Demonstrated

| Concept                               | Where                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Shared secret catalog                 | `infra/envpkt.toml`                                                          |
| Agent identity (`[agent]`)            | All agent configs                                                            |
| Catalog reference (`catalog = "..."`) | `data-pipeline`, `api-gateway`                                               |
| Capability narrowing (override)       | `data-pipeline` overrides `DATABASE_URL` to `SELECT` only                    |
| Standalone agent (no catalog)         | `monitoring`                                                                 |
| Expired secret detection              | `monitoring` — `DATADOG_API_KEY` expired 2026-01-01                          |
| Lifecycle policies                    | `infra` requires expiration + service; `monitoring` has 60-day stale warning |
| Sealed packets (encrypted values)     | `sealed-agent.toml` — age-encrypted secrets safe to commit                   |
