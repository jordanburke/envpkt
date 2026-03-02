# envpkt Common Patterns

## Agent Bootstrap

```typescript
import { bootSafe } from "envpkt"

const main = () => {
  const result = bootSafe({
    failOnExpired: true,
    inject: true,
  })

  result.fold(
    (err) => {
      console.error(`[envpkt] Boot failed: ${err._tag}`)
      process.exit(1)
    },
    (ok) => {
      console.log(`[envpkt] Injected: ${ok.injected.join(", ")}`)
      if (ok.skipped.length > 0) {
        console.warn(`[envpkt] Skipped: ${ok.skipped.join(", ")}`)
      }
      ok.warnings.forEach((w) => console.warn(`[envpkt] ${w}`))
      // process.env now has secrets — start your app
      startApp()
    },
  )
}
```

## CI Audit Gate

```bash
#!/bin/bash
# ci-gate.sh — fail CI on credential issues

# Strict audit: any non-healthy secret fails
envpkt audit --strict --format json > audit.json
if [ $? -ne 0 ]; then
  echo "Credential audit failed"
  cat audit.json
  exit 1
fi

# Drift detection: config vs live env
envpkt env check --strict
if [ $? -ne 0 ]; then
  echo "Environment drift detected"
  exit 1
fi
```

## Sealed Workflow

```bash
# 1. Initialize with agent identity
envpkt init --agent --name "my-agent"

# 2. Generate age keypair (if needed)
age-keygen -o keys/agent.age

# 3. Add recipient public key to envpkt.toml
#    recipient = "age1..."

# 4. Seal secret values
envpkt seal --profile prod

# 5. Commit — encrypted_value fields are safe to commit
git add envpkt.toml
git commit -m "seal: update encrypted credentials"

# 6. At runtime, boot decrypts sealed values automatically
# The agent's identity key (private) must be available
```

## Fleet Scanning

```bash
# Scan all agents in a directory tree
envpkt fleet -d /opt/agents --depth 3

# JSON output for dashboards
envpkt fleet -d /opt/agents --format json > fleet-health.json

# Filter critical agents only
envpkt fleet --status critical
```

```typescript
import { scanFleet } from "envpkt"

const fleet = scanFleet({ dir: "/opt/agents", depth: 3 })
console.log(`Fleet status: ${fleet.status}`)
console.log(`Total agents: ${fleet.total_agents}`)
console.log(`Expired secrets: ${fleet.expired}`)

fleet.agents.toArray().forEach((agent) => {
  if (agent.audit.status === "critical") {
    console.warn(`CRITICAL: ${agent.path}`)
  }
})
```

## Shell Hook Integration

```bash
# Add to ~/.zshrc
eval "$(envpkt shell-hook zsh)"

# Add to ~/.bashrc
eval "$(envpkt shell-hook bash)"

# Now when you `cd` into a directory with envpkt.toml,
# you get ambient warnings about expired/expiring credentials
```

## Environment Discovery

```bash
# Discover what credentials exist in your environment
envpkt env scan

# Preview TOML that would be generated
envpkt env scan --dry-run

# Write discovered credentials to envpkt.toml
envpkt env scan --write

# Include unknown/unrecognized vars
envpkt env scan --include-unknown
```

## MCP Server Integration

```json
// Claude Desktop config (~/.claude/claude_desktop_config.json)
{
  "mcpServers": {
    "envpkt": {
      "command": "npx",
      "args": ["envpkt", "mcp"]
    }
  }
}
```

```json
// Claude Code config (.mcp.json in project root)
{
  "mcpServers": {
    "envpkt": {
      "command": "npx",
      "args": ["envpkt", "mcp", "-c", "./envpkt.toml"]
    }
  }
}
```

## Error Recovery with Either

```typescript
import { bootSafe } from "envpkt"

const result = bootSafe()

result.fold(
  (err) => {
    switch (err._tag) {
      case "FileNotFound":
        // No config — auto-initialize or skip
        console.log("No envpkt.toml found, skipping credential management")
        break

      case "AuditFailed":
        // Credential health issue — degrade gracefully
        console.warn(`Audit warning: ${err.message}`)
        console.warn(`Status: ${err.audit.status}`)
        break

      case "FnoxNotFound":
      case "FnoxCliError":
        // fnox not available — fall back to env vars
        console.warn("fnox not available, using environment variables directly")
        break

      case "CatalogNotFound":
      case "SecretNotInCatalog":
        // Catalog issue — log and continue without catalog
        console.warn(`Catalog issue: ${err._tag}`)
        break

      default:
        // Unrecoverable
        console.error(`Boot failed: ${err._tag}`)
        process.exit(1)
    }
  },
  (ok) => {
    // Check for partial success
    if (ok.skipped.length > 0) {
      console.warn(`Some secrets could not be resolved: ${ok.skipped.join(", ")}`)
    }
  },
)
```

## Exec with Pre-flight

```bash
# Standard: audit then run
envpkt exec -- node server.js

# With fnox profile
envpkt exec --profile prod -- node server.js

# Skip audit for faster startup
envpkt exec --skip-audit -- python train.py

# Warn on issues but don't abort
envpkt exec --warn-only -- ./run.sh

# Strict: abort on any non-healthy secret
envpkt exec --strict -- ./deploy.sh
```

## Resolving Catalog References

```bash
# Preview resolved config
envpkt resolve --dry-run

# Output resolved TOML
envpkt resolve

# Output as JSON
envpkt resolve --format json

# Write resolved config to file
envpkt resolve -o resolved.toml
```

## Inspect Config

```bash
# View config structure
envpkt inspect

# View with catalog merged
envpkt inspect --resolved

# Show secret values (masked)
envpkt inspect --secrets

# Show plaintext values (careful!)
envpkt inspect --secrets --plaintext

# JSON output
envpkt inspect --format json
```
