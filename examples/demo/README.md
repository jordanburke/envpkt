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
