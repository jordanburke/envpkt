# envpkt.toml Reference

## Full Annotated Example

```toml
# Schema version (required)
version = 1

# Optional path to shared secret catalog (relative to this config file)
# When set, secrets listed in [agent].secrets are merged from the catalog
catalog = "../shared/catalog.toml"

# --- Agent Identity (optional) ---
[agent]
name = "data-processor"                    # Display name (required in [agent])
consumer = "agent"                         # "agent" | "service" | "developer" | "ci"
description = "Processes customer data"    # Agent role description
capabilities = ["read", "write", "admin"]  # Agent-level capabilities
expires = "2025-12-31"                     # Agent credential expiration (YYYY-MM-DD)
services = ["openai", "postgres", "s3"]    # Service dependencies
identity = "./keys/agent.age"             # Path to encrypted age identity key
recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"  # Age public key
secrets = ["OPENAI_API_KEY", "DB_PASSWORD"] # Keys to pull from catalog

# --- Per-Secret Metadata ---
# Each [meta.KEY_NAME] declares metadata about a secret.
# The secret VALUE is never stored here — only metadata.

[meta.OPENAI_API_KEY]
# Tier 1: Scan-first (auto-discovered by `envpkt env scan`)
service = "openai"
expires = "2025-06-30"
rotation_url = "https://platform.openai.com/api-keys"

# Tier 2: Context (human-annotated)
purpose = "LLM inference for data processing pipeline"
capabilities = ["chat", "embeddings"]
created = "2025-01-15"

# Tier 3: Operational
rotates = "90d"
rate_limit = "10000/min"
model_hint = "gpt-4"
source = "vault"

# Tier 4: Enforcement
required = true
tags = { team = "ml", env = "prod" }

[meta.DB_PASSWORD]
service = "postgres"
expires = "2025-09-30"
rotation_url = "https://console.aws.amazon.com/rds"
purpose = "Primary database access"
capabilities = ["read", "write"]
created = "2025-01-01"
rotates = "quarterly"
required = true

[meta.AWS_SECRET_ACCESS_KEY]
service = "aws"
expires = "2025-12-31"
purpose = "S3 bucket access for data storage"
capabilities = ["s3:GetObject", "s3:PutObject"]
source = "iam"
required = true
# Sealed value — age-encrypted, safe to commit
encrypted_value = "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24..."

# --- Lifecycle Policy (optional) ---
[lifecycle]
stale_warning_days = 90        # Days since creation to flag as stale (default: 90)
require_expiration = false     # Require expires on all secrets (default: false)
require_service = false        # Require service on all secrets (default: false)

# --- Callbacks (optional) ---
[callbacks]
on_expiring = "./scripts/notify-slack.sh"    # Runs when secrets are expiring soon
on_expired = "./scripts/alert-pagerduty.sh"  # Runs when secrets have expired
on_audit_fail = "./scripts/audit-alert.sh"   # Runs when audit fails

# --- Tools (optional) ---
# Open namespace for third-party tool integrations
[tools]
# Any key-value pairs for tool-specific configuration
```

## Minimal Examples

### Bare minimum

```toml
version = 1

[meta.MY_API_KEY]
service = "my-service"
```

### CI pipeline

```toml
version = 1

[agent]
name = "ci-runner"
consumer = "ci"

[meta.NPM_TOKEN]
service = "npm"
required = true

[meta.GITHUB_TOKEN]
service = "github"
required = true

[lifecycle]
require_service = true
```

### Agent with sealed secrets

```toml
version = 1

[agent]
name = "research-agent"
consumer = "agent"
identity = "./keys/agent.age"
recipient = "age1..."

[meta.ANTHROPIC_API_KEY]
service = "anthropic"
purpose = "LLM inference"
encrypted_value = "-----BEGIN AGE ENCRYPTED FILE-----\n..."
```

### Shared catalog consumer

```toml
version = 1
catalog = "../shared/catalog.toml"

[agent]
name = "team-agent"
consumer = "agent"
secrets = ["OPENAI_API_KEY", "SLACK_TOKEN"]
```

## Catalog Merge Behavior

When `catalog` is set and `[agent].secrets` lists key names:

1. envpkt loads the catalog file (another `envpkt.toml` with `[meta.*]` entries)
2. For each key in `secrets`, it looks up `[meta.KEY]` in the catalog
3. Catalog metadata is merged into the local config
4. Local `[meta.KEY]` fields override catalog fields (local wins)
5. If a key in `secrets` is not found in the catalog, a `SecretNotInCatalog` error is returned

## Schema Validation

The JSON schema is available for editor autocomplete:

```json
// In your editor's JSON schema settings, point to:
"./node_modules/envpkt/schemas/envpkt.schema.json"
```

Rebuild the schema after modifying `src/core/schema.ts`:

```bash
pnpm build:schema
```
