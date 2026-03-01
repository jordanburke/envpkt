# envpkt Examples

Standalone example configurations demonstrating envpkt features. All standalone examples audit as **HEALTHY**.

## Examples

| File                      | Description                                                          | Run                                                      |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `minimal.toml`            | Bare-minimum config — one secret, one service                        | `npx envpkt inspect -c examples/minimal.toml`            |
| `full-agent.toml`         | Full agent with lifecycle policies, callbacks, and tool integrations | `npx envpkt audit -c examples/full-agent.toml`           |
| `ci-agent.toml`           | CI/CD deployment agent (GitHub, GHCR, Kubernetes)                    | `npx envpkt audit -c examples/ci-agent.toml`             |
| `saas-integration.toml`   | SaaS billing service (Stripe, SendGrid, Redis)                       | `npx envpkt audit -c examples/saas-integration.toml`     |
| `catalog.toml`            | Shared secret catalog — team-owned metadata                          | `npx envpkt inspect -c examples/catalog.toml`            |
| `agent-with-catalog.toml` | Agent referencing a shared catalog with capability narrowing         | `npx envpkt resolve -c examples/agent-with-catalog.toml` |
| `sealed-agent.toml`       | Sealed packets — age-encrypted secrets safe to commit                | `npx envpkt inspect -c examples/sealed-agent.toml`       |

## Audit all examples

```bash
for f in examples/*.toml; do echo "=== $f ===" && npx envpkt audit -c "$f"; done
```

All standalone examples should report **HEALTHY**.

## Multi-agent demo

The `demo/` directory contains a fleet walkthrough with a shared catalog, multiple agents, and an intentionally expired secret for demonstrating audit warnings. See [`demo/README.md`](demo/README.md) for the full walkthrough.
