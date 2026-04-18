---
name: envpkt
description: Help developers use envpkt for credential management — CLI usage, envpkt.toml configuration, library API, boot patterns, MCP server integration, and fleet health monitoring. Use when setting up credential management, writing envpkt.toml files, integrating the boot API, running CLI commands, or configuring the MCP server.
---

# envpkt

## Overview

envpkt is a credential lifecycle and fleet management tool for AI agents. It provides:

- **CLI** (`envpkt`) — 13 commands for credential setup, keygen, auditing, sealing, fleet scanning, and environment management
- **Library API** — Programmatic access via `import { boot, bootSafe, computeAudit, ... } from "envpkt"`
- **MCP Server** — Expose credential health and capabilities to LLM agents via Model Context Protocol
- **Configuration** — `envpkt.toml` declares per-secret metadata across 5 tiers with lifecycle policies, plus `[env.*]` for plaintext environment defaults

envpkt stores metadata about secrets (service, expiration, purpose, capabilities) and can optionally store age-encrypted secret values as sealed packets (safe to commit). At runtime, values are resolved from sealed packets, fnox, or environment variables.

## When to Use This Skill

- Setting up credential management in a project (`envpkt init`)
- Writing or editing `envpkt.toml` configuration
- Using the boot API to inject credentials into an application
- Running CLI commands for auditing, sealing, fleet scanning
- Configuring the envpkt MCP server for LLM agent access
- Debugging credential health issues
- Integrating envpkt into CI/CD pipelines

## Quick Start

### 1. Initialize

```bash
# Basic initialization
envpkt init

# From existing fnox.toml
envpkt init --from-fnox

# With identity section
envpkt init --identity --name "my-agent" --capabilities "read,write"
```

### 2. Discover credentials

```bash
# Scan environment for credentials
envpkt env scan

# Write discovered credentials to envpkt.toml
envpkt env scan --write
```

### 3. Generate encryption key

```bash
# Generate age keypair — writes to ~/.envpkt/<project>-key.txt by default
envpkt keygen

# Distinct key per config (prod and dev get separate keys automatically)
envpkt keygen -c prod.envpkt.toml   # → ~/.envpkt/<project>-prod-key.txt
envpkt keygen -c dev.envpkt.toml    # → ~/.envpkt/<project>-dev-key.txt

# Custom output path
envpkt keygen -o ./keys/agent-key.txt

# Use the shared global default (rare — prefer project-specific)
envpkt keygen --global
```

**Key rotation**: `keygen` refuses to overwrite existing keys. To rotate, `rm` the file first, then re-run. This prevents silently destroying data sealed against the old key.

**Always set `key_file` explicitly** in `envpkt.toml` — the config then tells you which key it needs, and you never depend on the fragile default path.

### 4. Audit health

```bash
envpkt audit
envpkt audit --strict          # Exit non-zero on any non-healthy secret
envpkt audit --format json     # Machine-readable output
```

### 5. Programmatic boot

```typescript
import { boot, bootSafe } from "envpkt"

// Throwing API
const result = boot()

// Either-based API (recommended)
const result = bootSafe()
result.fold(
  (err) => console.error(`Boot failed: ${err._tag}`),
  (ok) => console.log(`Injected ${ok.injected.length} secrets`),
)
```

## envpkt.toml Configuration

See `references/envpkt-toml-reference.md` for the complete annotated schema.

### Structure

```toml
version = 1
catalog = "./shared-catalog.toml"   # Optional shared catalog path

[identity]
name = "my-agent"
consumer = "agent"                  # "agent" | "service" | "developer" | "ci"
description = "Data processing agent"
capabilities = ["read", "write"]
expires = "2025-12-31"
services = ["openai", "postgres"]
key_file = "./keys/agent.age"       # Path to encrypted age key
recipient = "age1..."               # Public key for encryption
secrets = ["OPENAI_API_KEY"]        # Keys to pull from catalog

[env.NODE_ENV]                          # Non-secret environment defaults
value = "production"
purpose = "Runtime environment mode"
comment = "Override to 'development' for local testing"

[secret.OPENAI_API_KEY]               # Per-secret metadata
service = "openai"
expires = "2025-06-30"
rotation_url = "https://platform.openai.com/api-keys"
purpose = "LLM inference for data processing"
comment = "Shared across all ML agents"
capabilities = ["chat", "embeddings"]
created = "2025-01-15"
rotates = "90d"
rate_limit = "10000/min"
model_hint = "gpt-4"
source = "vault"
required = true
tags = { team = "ml", env = "prod" }

[lifecycle]
stale_warning_days = 90
require_expiration = false
require_service = false

[callbacks]
on_expiring = "slack-notify.sh"
on_expired = "slack-alert.sh"
on_audit_fail = "pagerduty-alert.sh"

[tools]
# Open namespace for third-party extensions
```

### Secret Metadata Tiers

| Tier            | Fields                                          | Purpose                            |
| --------------- | ----------------------------------------------- | ---------------------------------- |
| 1 — Scan-first  | `service`, `expires`, `rotation_url`            | Auto-discovered by `env scan`      |
| 2 — Context     | `purpose`, `comment`, `capabilities`, `created` | Human-annotated context            |
| 3 — Operational | `rotates`, `rate_limit`, `model_hint`, `source` | Runtime operational data           |
| 4 — Enforcement | `required`, `tags`                              | Policy enforcement and filtering   |
| Sealed          | `encrypted_value`                               | Age-encrypted value safe to commit |
| Alias           | `from_key`                                      | Reuse another entry's value        |

### Aliases (`from_key`)

Use `from_key` to expose one governed value under multiple canonical env var
names without duplication. Works identically on `[secret.*]` and `[env.*]`:

```toml
[secret.API_KEY]
service = "example"
expires = "2026-12-31"

[secret.LEGACY_API_KEY]
from_key = "secret.API_KEY"   # reuses the governed value under a second name
```

Rules: same-type only (secret→secret, env→env), single hop (no chains), and
mutually exclusive with `encrypted_value` / `value`. Both target and alias are
injected into `process.env` at boot. Audit and MCP report aliases as first-class
rows with inherited status and an `alias_of` marker — lifecycle tracking lives
on the target, so an alias is healthy iff its target is. Cross-type aliasing
(secret → env) is rejected at config load time.

## CLI Command Reference

See `references/quick-reference.md` for a compact cheat sheet.

### Setup

| Command                   | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `envpkt init`             | Initialize `envpkt.toml` in the current directory |
| `envpkt keygen`           | Generate age keypair for sealing secrets          |
| `envpkt env scan`         | Auto-discover credentials from `process.env`      |
| `envpkt env scan --write` | Write discovered credentials to `envpkt.toml`     |

**init options**: `--from-fnox [path]`, `--catalog <path>`, `--identity`, `--name <name>`, `--capabilities <caps>`, `--expires <date>`, `--force`

**keygen options**: `-c <path>`, `-o <path>`, `--global`

**env scan options**: `--format table|json`, `--write`, `--dry-run`, `--include-unknown`

### Health & Inspection

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `envpkt audit`     | Audit credential health                           |
| `envpkt inspect`   | Display structured view of config                 |
| `envpkt env check` | Bidirectional drift detection vs live environment |

**audit options**: `-c <path>`, `--format table|json|minimal`, `--expiring <days>`, `--status <status>`, `--strict`, `--all`, `--env-only`, `--sealed`, `--external`

**inspect options**: `-c <path>`, `--format table|json`, `--resolved`, `--secrets`, `--plaintext`

**env check options**: `-c <path>`, `--format table|json`, `--strict`

### Operations

| Command                    | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `envpkt exec <command...>` | Pre-flight audit then execute with injected env    |
| `envpkt seal`              | Encrypt secret values into config using age        |
| `envpkt resolve`           | Resolve catalog references into flat config        |
| `envpkt env export`        | Output `export` statements for eval-ing into shell |

**exec options**: `-c <path>`, `--profile <profile>`, `--skip-audit` / `--no-check`, `--warn-only`, `--strict`

**seal options**: `-c <path>`, `--profile <profile>`, `--reseal` (re-encrypt all including already sealed), `--edit <keys>` (comma-separated keys to re-seal with new interactively-prompted values)

**resolve options**: `-c <path>`, `-o <path>`, `--format toml|json`, `--dry-run`

**env export options**: `-c <path>`, `--profile <profile>`, `--skip-audit`

### Secret Management (CRUD)

| Command                            | Description                                  |
| ---------------------------------- | -------------------------------------------- |
| `envpkt secret add <name>`         | Add a new secret entry to `envpkt.toml`      |
| `envpkt secret edit <name>`        | Update metadata fields on an existing secret |
| `envpkt secret rm <name>`          | Remove a secret entry from `envpkt.toml`     |
| `envpkt secret rename <old> <new>` | Rename a secret entry, preserving metadata   |

**secret add options**: `-c <path>`, `--service`, `--purpose`, `--comment`, `--expires <YYYY-MM-DD>`, `--capabilities <comma-separated>`, `--rotates <schedule>`, `--rate-limit`, `--model-hint`, `--source`, `--rotation-url`, `--tags <key=val,...>`, `--required`, `--dry-run`

**secret edit options**: Same as add, plus `--no-required` to unset required flag

**secret rm options**: `-c <path>`, `--dry-run`

**secret rename options**: `-c <path>`, `--dry-run`

### Env Defaults Management (CRUD)

| Command                         | Description                                |
| ------------------------------- | ------------------------------------------ |
| `envpkt env add <name> <value>` | Add a new env default entry                |
| `envpkt env edit <name>`        | Update fields on an existing env entry     |
| `envpkt env rm <name>`          | Remove an env entry from `envpkt.toml`     |
| `envpkt env rename <old> <new>` | Rename an env entry, preserving all fields |

**env add options**: `-c <path>`, `--purpose`, `--comment`, `--tags <key=val,...>`, `--dry-run`

**env edit options**: `-c <path>`, `--value <new-value>`, `--purpose`, `--comment`, `--tags <key=val,...>`, `--dry-run`

**env rm options**: `-c <path>`, `--dry-run`

**env rename options**: `-c <path>`, `--dry-run`

### Fleet & Integration

| Command                     | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `envpkt fleet`              | Scan directory tree for `envpkt.toml` files and aggregate health |
| `envpkt mcp`                | Start the envpkt MCP server (stdio transport)                    |
| `envpkt shell-hook <shell>` | Output shell function for ambient credential warnings on `cd`    |

**fleet options**: `-d <path>`, `--depth <n>`, `--format table|json`, `--status <status>`

**mcp options**: `-c <path>`

**shell-hook**: argument is `zsh` or `bash`

## Library API Reference

### Boot API

```typescript
import { boot, bootSafe, EnvpktBootError } from "envpkt"

// boot(options?) — throws EnvpktBootError on failure
const result: BootResult = boot({ configPath: "./envpkt.toml" })

// bootSafe(options?) — returns Either<BootError, BootResult>
const result: Either<BootError, BootResult> = bootSafe({ inject: true })
```

**BootOptions**:

- `configPath?: string` — path to envpkt.toml
- `profile?: string` — fnox profile
- `inject?: boolean` — inject into `process.env` (default: `true`)
- `failOnExpired?: boolean` — fail on expired secrets (default: `true`)
- `warnOnly?: boolean` — warn instead of fail (default: `false`)

**BootResult**:

- `audit: AuditResult` — full audit of all secrets
- `injected: ReadonlyArray<string>` — keys successfully injected
- `skipped: ReadonlyArray<string>` — keys that could not be resolved
- `secrets: Readonly<Record<string, string>>` — resolved secret values
- `warnings: ReadonlyArray<string>` — non-fatal warnings
- `configPath: string` — resolved path to the config file
- `configSource: ConfigSource` — how the config was found: `"flag"` | `"env"` | `"cwd"` | `"search"`

### Config Loading

```typescript
import { loadConfig, loadConfigFromCwd, resolveConfigPath, discoverConfig, findConfigPath } from "envpkt"

// Resolve config path via full chain: flag → env → CWD → discovery
// Returns Either<ConfigError, ResolvedPath> where ResolvedPath = { path, source }
const resolved = resolveConfigPath("./envpkt.toml")
resolved.fold(
  (err) => console.error(err._tag),
  ({ path, source }) => console.log(`Loaded from ${source}: ${path}`),
)

// Discover config (CWD → ENVPKT_SEARCH_PATH → built-in paths)
// Returns Option<{ path, source: "cwd" | "search" }>
const found = discoverConfig()

// Load and validate config (Either<ConfigError, EnvpktConfig>)
const config = loadConfig("/path/to/envpkt.toml")

// Load from CWD or discovery chain
const config = loadConfigFromCwd()
```

### Audit Engine

```typescript
import { computeAudit } from "envpkt"

const audit: AuditResult = computeAudit(config)
// audit.status: "healthy" | "degraded" | "critical"
// audit.secrets: List<SecretHealth> — per-secret details
// audit.total, audit.healthy, audit.expired, audit.expiring_soon, etc.
```

### Environment Scanning

```typescript
import { envScan, envCheck, generateTomlFromScan } from "envpkt"

// Scan environment for credentials
const scan: ScanResult = envScan({ includeUnknown: false })

// Check drift between config and environment
const check: CheckResult = envCheck(config)

// Generate TOML from scan results
const toml: string = generateTomlFromScan(scan)
```

### Pattern Matching

```typescript
import { scanEnv, matchEnvVar, deriveServiceFromName } from "envpkt"

// Scan all env vars for credential patterns
const results = scanEnv(process.env)

// Match a single env var
const match: MatchResult | undefined = matchEnvVar("OPENAI_API_KEY", "sk-...")

// Derive service name from env var name
const service: string | undefined = deriveServiceFromName("AWS_SECRET_ACCESS_KEY")
```

### Sealing (age encryption)

```typescript
import { sealSecrets, unsealSecrets, ageEncrypt, ageDecrypt } from "envpkt"

// Encrypt values into config meta
const sealed = sealSecrets(meta, recipientPublicKey)

// Decrypt sealed values
const unsealed = unsealSecrets(meta, identityPath)
```

### Fleet Scanning

```typescript
import { scanFleet } from "envpkt"

const fleet: FleetHealth = scanFleet({ dir: ".", depth: 3 })
// fleet.status: "healthy" | "degraded" | "critical"
// fleet.agents: List<FleetAgent>
```

### Catalog Resolution

```typescript
import { resolveConfig, loadCatalog, resolveSecrets } from "envpkt"

// Resolve catalog references
const result: Either<CatalogError, ResolveResult> = resolveConfig(config, configDir)
```

### Value Resolution

```typescript
import { resolveValues } from "envpkt"

// Resolve secret values from fnox/environment
const values = resolveValues(config, options)
```

### Keygen

```typescript
import { generateKeypair, resolveKeyPath, resolveInlineKey, updateConfigRecipient } from "envpkt"

// Generate age keypair
const result = generateKeypair({ outputPath: "~/.envpkt/age-key.txt" })

// Resolve key path: ENVPKT_AGE_KEY_FILE env > ~/.envpkt/age-key.txt
const keyPath: string = resolveKeyPath()

// Check for inline key (CI): ENVPKT_AGE_KEY env
const inlineKey: Option<string> = resolveInlineKey()

// Update identity.recipient in envpkt.toml
const updated = updateConfigRecipient("envpkt.toml", "age1...")
```

### fnox Integration

```typescript
import { fnoxAvailable, detectFnox, fnoxExport, fnoxGet } from "envpkt"
import { unwrapAgentKey, ageAvailable } from "envpkt"
import { readFnoxConfig, extractFnoxKeys, compareFnoxAndEnvpkt } from "envpkt"
```

## Common Use Cases

### Agent Bootstrap Pattern

```typescript
import { bootSafe } from "envpkt"

const main = () => {
  const result = bootSafe({ failOnExpired: true })

  result.fold(
    (err) => {
      switch (err._tag) {
        case "FileNotFound":
          console.error("No envpkt.toml found — run: envpkt init")
          break
        case "AuditFailed":
          console.error(`Credential health check failed: ${err.message}`)
          break
        default:
          console.error(`Boot error [${err._tag}]: ${JSON.stringify(err)}`)
      }
      process.exit(1)
    },
    (ok) => {
      console.log(`Injected ${ok.injected.length} secrets`)
      if (ok.warnings.length > 0) {
        ok.warnings.forEach((w) => console.warn(`Warning: ${w}`))
      }
      // Secrets are now in process.env — start your application
    },
  )
}
```

### CI/CD Audit Gate

```bash
# Fail CI if any secret is non-healthy
envpkt audit --strict --format json

# Fail CI on drift between config and environment
envpkt env check --strict
```

### Sealed Packets (commit-safe encrypted values)

```bash
# Seal secrets with agent's age public key
envpkt seal

# Values are stored as encrypted_value in envpkt.toml
# Safe to commit — only the agent's private key can decrypt
```

### Fleet Health Dashboard

```bash
# Scan all agents in a directory tree
envpkt fleet -d /opt/agents --depth 3 --format json

# Filter by status
envpkt fleet --status critical
```

### Shell Hook (ambient warnings)

```bash
# Add to .zshrc
eval "$(envpkt shell-hook zsh)"

# Warns when you cd into a directory with expired credentials
```

### Exec with Pre-flight Audit

```bash
# Run a command with credential injection and pre-flight check
envpkt exec -- node server.js

# Skip audit for speed
envpkt exec --skip-audit -- python train.py

# Warn but don't abort on issues
envpkt exec --warn-only -- ./run.sh
```

### Environment Export

```bash
# Export secrets into current shell
eval "$(envpkt env export)"

# With specific fnox profile
eval "$(envpkt env export --profile prod)"
```

## Common Workflows

### New Project Setup

```bash
envpkt init --identity --name "my-agent"    # 1. Create envpkt.toml
envpkt env scan --write                      # 2. Discover existing credentials
envpkt keygen                                # 3. Generate age keypair
envpkt secret add OPENAI_API_KEY \           # 4. Add secrets with metadata
  --service openai --expires 2025-12-31 \
  --capabilities "chat,embeddings"
envpkt seal                                  # 5. Encrypt values into config
```

### Adding a New Secret

```bash
envpkt secret add NEW_API_KEY --service stripe --purpose "Payment processing"
envpkt seal --edit NEW_API_KEY               # Prompts for value, encrypts it
```

### Rotating a Secret Value

```bash
# Re-seal a specific key with a new value (interactive prompt)
envpkt seal --edit OPENAI_API_KEY

# Re-encrypt ALL secrets (e.g. after rotating the age keypair)
envpkt seal --reseal
```

### Editing Secret Metadata

```bash
# Update expiration and rotation schedule
envpkt secret edit OPENAI_API_KEY --expires 2026-06-30 --rotates 90d

# Preview changes without writing
envpkt secret edit OPENAI_API_KEY --expires 2026-06-30 --dry-run
```

### Managing Env Defaults

```bash
# Add a non-secret environment default
envpkt env add NODE_ENV production --purpose "Runtime environment mode"

# Update value
envpkt env edit NODE_ENV --value development

# Rename
envpkt env rename NODE_ENV APP_ENV

# Remove
envpkt env rm APP_ENV
```

### Pre-deploy Audit

```bash
envpkt audit --strict                        # Fail on any non-healthy secret
envpkt env check --strict                    # Fail on config/env drift
envpkt exec --strict -- ./deploy.sh          # Audit + run in one step
```

## Error Handling

All errors are tagged unions with a `_tag` discriminant:

### BootError Tags

| Tag                  | Meaning                                  |
| -------------------- | ---------------------------------------- |
| `FileNotFound`       | `envpkt.toml` not found at path          |
| `ParseError`         | TOML parse failure                       |
| `ValidationError`    | Schema validation failed                 |
| `ReadError`          | File read error                          |
| `FnoxNotFound`       | fnox CLI not installed                   |
| `FnoxCliError`       | fnox command failed                      |
| `FnoxParseError`     | fnox output parse failure                |
| `AuditFailed`        | Credential audit failed policy           |
| `CatalogNotFound`    | Catalog file not found                   |
| `CatalogLoadError`   | Catalog load/parse error                 |
| `SecretNotInCatalog` | Requested secret not in catalog          |
| `MissingSecretsList` | Identity has no secrets list for catalog |
| `AgeNotFound`        | age CLI not installed                    |
| `DecryptFailed`      | Decryption failed                        |
| `IdentityNotFound`   | Agent identity file not found            |

### KeygenError Tags

| Tag                 | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `AgeNotFound`       | `age-keygen` CLI not found on PATH                   |
| `KeygenFailed`      | `age-keygen` command failed                          |
| `KeyExists`         | Identity file already exists (`rm` first to replace) |
| `WriteError`        | Failed to write identity file                        |
| `ConfigUpdateError` | Failed to update `envpkt.toml`                       |

### Pattern: Error Recovery with Either

```typescript
import { bootSafe } from "envpkt"

bootSafe().fold(
  (err) => {
    // Handle by tag
    switch (err._tag) {
      case "FileNotFound":
        // Auto-initialize
        break
      case "AuditFailed":
        // Log and continue with degraded mode
        console.warn(err.message)
        break
      default:
        throw new Error(`Unrecoverable: ${err._tag}`)
    }
  },
  (result) => {
    // Success path
  },
)
```

### Health Statuses

| Status             | Level   | Meaning                             |
| ------------------ | ------- | ----------------------------------- |
| `healthy`          | Secret  | All checks pass                     |
| `expiring_soon`    | Secret  | Expires within `stale_warning_days` |
| `expired`          | Secret  | Past expiration date                |
| `stale`            | Secret  | No rotation for too long            |
| `missing`          | Secret  | Not found in environment            |
| `missing_metadata` | Secret  | Lacks required metadata fields      |
| `healthy`          | Overall | All secrets healthy                 |
| `degraded`         | Overall | Some secrets have warnings          |
| `critical`         | Overall | Expired or missing secrets          |

## MCP Server

### Starting

```bash
envpkt mcp
envpkt mcp -c /path/to/envpkt.toml
```

### Tools

| Tool               | Description                     | Required Args |
| ------------------ | ------------------------------- | ------------- |
| `getPacketHealth`  | Overall credential health audit | —             |
| `listCapabilities` | Agent + per-secret capabilities | —             |
| `getSecretMeta`    | Metadata for a specific secret  | `key`         |
| `checkExpiration`  | Expiration status of a secret   | `key`         |

All tools accept an optional `configPath` argument.

### Resources

| URI                     | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `envpkt://health`       | Current credential health (JSON)                |
| `envpkt://capabilities` | Agent capabilities and per-secret grants (JSON) |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "envpkt": {
      "command": "npx",
      "args": ["envpkt", "mcp"],
      "env": {}
    }
  }
}
```

## Debugging Tips

- **Config not found**: envpkt searches up from cwd. Use `-c <path>` to specify explicitly.
- **Audit shows "missing"**: The secret key is in `[secret.*]` but not in the environment. Check `envpkt env check`.
- **Sealed values fail**: Ensure `age` CLI is installed and the identity file path in `[identity].identity` is correct.
- **fnox errors**: Check `fnox` is installed and configured. Use `envpkt inspect --resolved` to see what the config looks like after catalog merge.
- **Boot skips secrets**: Check `bootSafe()` result's `skipped` array and `warnings` for details.
- **Schema validation**: Run `envpkt inspect` to see validation errors. The JSON schema is available at `envpkt/schema` export for editor autocomplete.

## TypeBox Schema

envpkt uses TypeBox for schema-first design. The JSON schema is exported for editor autocomplete:

```json
{
  "$schema": "./node_modules/envpkt/schemas/envpkt.schema.json"
}
```

Import schemas for runtime validation:

```typescript
import { EnvpktConfigSchema, SecretMetaSchema, IdentitySchema } from "envpkt"
```
