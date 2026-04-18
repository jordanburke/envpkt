# envpkt Quick Reference

## CLI Commands

| Command                            | Description                   | Key Options                                                  |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------ | ------------------ |
| `envpkt init`                      | Initialize `envpkt.toml`      | `--from-fnox`, `--identity`, `--name`, `--force`             |
| `envpkt audit`                     | Audit credential health       | `--strict`, `--format`, `--expiring <days>`, `--status`      |
| `envpkt inspect`                   | Display config view           | `--resolved`, `--secrets`, `--plaintext`, `--format`         |
| `envpkt exec <cmd>`                | Audit + run with injected env | `--skip-audit`, `--warn-only`, `--strict`, `--profile`       |
| `envpkt seal`                      | Encrypt values with age       | `--profile`, `--reseal`, `--edit <keys>`                     |
| `envpkt resolve`                   | Flatten catalog references    | `-o <path>`, `--format toml                                  | json`, `--dry-run` |
| `envpkt fleet`                     | Scan directory tree health    | `-d <path>`, `--depth`, `--status`, `--format`               |
| `envpkt mcp`                       | Start MCP server (stdio)      | `-c <path>`                                                  |
| `envpkt env scan`                  | Discover credentials in env   | `--write`, `--dry-run`, `--include-unknown`                  |
| `envpkt env check`                 | Drift detection vs live env   | `--strict`, `--format`                                       |
| `envpkt env export`                | Output `export` statements    | `--profile`, `--skip-audit`                                  |
| `envpkt shell-hook <sh>`           | Shell cd-hook for warnings    | `zsh` or `bash`                                              |
| `envpkt secret add <name>`         | Add secret entry              | `--service`, `--purpose`, `--expires`, `--tags`, `--dry-run` |
| `envpkt secret edit <name>`        | Update secret metadata        | `--service`, `--purpose`, `--expires`, `--tags`, `--dry-run` |
| `envpkt secret rm <name>`          | Remove secret entry           | `-c`, `--dry-run`                                            |
| `envpkt secret rename <old> <new>` | Rename secret entry           | `-c`, `--dry-run`                                            |
| `envpkt env add <name> <value>`    | Add env default entry         | `--purpose`, `--comment`, `--tags`, `--dry-run`              |
| `envpkt env edit <name>`           | Update env entry fields       | `--value`, `--purpose`, `--comment`, `--tags`, `--dry-run`   |
| `envpkt env rm <name>`             | Remove env entry              | `-c`, `--dry-run`                                            |
| `envpkt env rename <old> <new>`    | Rename env entry              | `-c`, `--dry-run`                                            |

## Library Functions

### Boot

| Function   | Signature                                                  | Returns                             |
| ---------- | ---------------------------------------------------------- | ----------------------------------- |
| `boot`     | `(options?: BootOptions) => BootResult`                    | Throws `EnvpktBootError` on failure |
| `bootSafe` | `(options?: BootOptions) => Either<BootError, BootResult>` | Functional error handling           |

### Config

| Function                                      | Returns                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `resolveConfigPath(flagPath?, envVar?, cwd?)` | `Either<ConfigError, ResolvedPath>`                                           |
| `discoverConfig(cwd?)`                        | `Option<{ path: string; source: "cwd" \| "search" }>`                         |
| `loadConfig(path)`                            | `Either<ConfigError, EnvpktConfig>`                                           |
| `loadConfigFromCwd(cwd?)`                     | `Either<ConfigError, { path: string; source: string; config: EnvpktConfig }>` |
| `findConfigPath(dir)`                         | `Option<string>`                                                              |
| `parseToml(content)`                          | `Either<ConfigError, unknown>`                                                |
| `readConfigFile(path)`                        | `Either<ConfigError, string>`                                                 |
| `validateConfig(data)`                        | `Either<ConfigError, EnvpktConfig>`                                           |

### Audit & Health

| Function                          | Returns       |
| --------------------------------- | ------------- |
| `computeAudit(config, fnoxKeys?)` | `AuditResult` |
| `envScan(options?)`               | `ScanResult`  |
| `envCheck(config)`                | `CheckResult` |
| `scanFleet(options)`              | `FleetHealth` |

### Sealing

| Function                               | Returns                                         |
| -------------------------------------- | ----------------------------------------------- |
| `sealSecrets(meta, recipient)`         | `Either<SealError, Record<string, SecretMeta>>` |
| `unsealSecrets(meta, identityPath)`    | `Either<SealError, Record<string, string>>`     |
| `ageEncrypt(plaintext, recipient)`     | `Either<SealError, string>`                     |
| `ageDecrypt(ciphertext, identityPath)` | `Either<SealError, string>`                     |

### Catalog

| Function                           | Returns                               |
| ---------------------------------- | ------------------------------------- |
| `resolveConfig(config, configDir)` | `Either<CatalogError, ResolveResult>` |
| `loadCatalog(path)`                | `Either<CatalogError, EnvpktConfig>`  |
| `resolveSecrets(config, catalog)`  | `Either<CatalogError, EnvpktConfig>`  |

### Aliases

| Function                   | Returns                         |
| -------------------------- | ------------------------------- |
| `validateAliases(config)`  | `Either<AliasError, AliasTable>` |
| `isSecretAlias(meta)`      | `boolean`                       |
| `isEnvAlias(meta)`         | `boolean`                       |
| `formatAliasError(err)`    | `string`                        |

### Pattern Matching

| Function                     | Returns                    |
| ---------------------------- | -------------------------- |
| `scanEnv(env)`               | `ScanResult`               |
| `matchEnvVar(key, value)`    | `MatchResult \| undefined` |
| `matchValueShape(value)`     | `MatchResult \| undefined` |
| `deriveServiceFromName(key)` | `string \| undefined`      |

### Formatting

| Function                         | Returns  |
| -------------------------------- | -------- |
| `formatPacket(config, options?)` | `string` |
| `maskValue(value)`               | `string` |

## TOML Fields

### `[identity]`

| Field          | Type                                          | Description                   |
| -------------- | --------------------------------------------- | ----------------------------- |
| `name`         | `string`                                      | Agent display name (required) |
| `consumer`     | `"agent" \| "service" \| "developer" \| "ci"` | Consumer classification       |
| `description`  | `string`                                      | Agent role description        |
| `capabilities` | `string[]`                                    | Agent capabilities            |
| `expires`      | `YYYY-MM-DD`                                  | Agent credential expiration   |
| `services`     | `string[]`                                    | Service dependencies          |
| `identity`     | `string`                                      | Path to encrypted age key     |
| `recipient`    | `string`                                      | Age public key                |
| `secrets`      | `string[]`                                    | Keys to pull from catalog     |

### `[secret.*]`

| Field             | Tier   | Type                     | Description                          |
| ----------------- | ------ | ------------------------ | ------------------------------------ |
| `service`         | 1      | `string`                 | Service this secret authenticates to |
| `expires`         | 1      | `YYYY-MM-DD`             | Secret expiration date               |
| `rotation_url`    | 1      | `URL`                    | Where to rotate                      |
| `purpose`         | 2      | `string`                 | Why this secret exists               |
| `comment`         | 2      | `string`                 | Free-form annotation or note         |
| `capabilities`    | 2      | `string[]`               | What operations it grants            |
| `created`         | 2      | `YYYY-MM-DD`             | Provisioning date                    |
| `rotates`         | 3      | `string`                 | Rotation schedule (e.g. `"90d"`)     |
| `rate_limit`      | 3      | `string`                 | Rate limit info                      |
| `model_hint`      | 3      | `string`                 | Suggested model/tier                 |
| `source`          | 3      | `string`                 | Value origin (vault, ci, etc.)       |
| `encrypted_value` | sealed | `string`                 | Age-encrypted ciphertext             |
| `from_key`        | alias  | `"secret.<KEY>"`         | Alias — reuse another entry's value  |
| `required`        | 4      | `boolean`                | Whether required for operation       |
| `tags`            | 4      | `Record<string, string>` | Key-value tags                       |

### `[env.*]`

| Field      | Type                     | Description                             |
| ---------- | ------------------------ | --------------------------------------- |
| `value`    | `string`                 | Default value (required unless aliased) |
| `from_key` | `"env.<KEY>"`            | Alias — reuse another entry's value     |
| `purpose`  | `string`                 | Why this env var exists                 |
| `comment`  | `string`                 | Free-form annotation or note            |
| `tags`     | `Record<string, string>` | Key-value tags for grouping/filtering   |

### `[lifecycle]`

| Field                | Default | Description                      |
| -------------------- | ------- | -------------------------------- |
| `stale_warning_days` | `90`    | Days to consider stale           |
| `require_expiration` | `false` | Require `expires` on all secrets |
| `require_service`    | `false` | Require `service` on all secrets |

### `[callbacks]`

| Field           | Description                           |
| --------------- | ------------------------------------- |
| `on_expiring`   | Command/webhook when secrets expiring |
| `on_expired`    | Command/webhook when secrets expired  |
| `on_audit_fail` | Command/webhook on audit failure      |

## Error Tags

| Tag                  | Source                  | Meaning                     |
| -------------------- | ----------------------- | --------------------------- |
| `FileNotFound`       | ConfigError             | envpkt.toml not found       |
| `ParseError`         | ConfigError             | TOML parse failure          |
| `ValidationError`    | ConfigError             | Schema validation failed    |
| `ReadError`          | ConfigError             | File read error             |
| `FnoxNotFound`       | FnoxError               | fnox CLI not installed      |
| `FnoxCliError`       | FnoxError               | fnox command failed         |
| `FnoxParseError`     | FnoxError               | fnox output parse failure   |
| `AuditFailed`        | BootError               | Audit policy violation      |
| `CatalogNotFound`    | CatalogError            | Catalog file missing        |
| `CatalogLoadError`   | CatalogError            | Catalog load/parse error    |
| `SecretNotInCatalog` | CatalogError            | Key not in catalog          |
| `MissingSecretsList` | CatalogError            | No secrets list on identity |
| `AgeNotFound`        | IdentityError           | age CLI not installed       |
| `DecryptFailed`      | IdentityError/SealError | Decryption failure          |
| `IdentityNotFound`   | IdentityError           | Identity file missing       |
| `EncryptFailed`      | SealError               | Encryption failure          |
| `NoRecipient`        | SealError               | No recipient public key     |

## Health Statuses

### Secret-level (`SecretStatus`)

`healthy` | `expiring_soon` | `expired` | `stale` | `missing` | `missing_metadata`

### Overall (`HealthStatus`)

`healthy` | `degraded` | `critical`

## MCP Tools

| Tool               | Args                 | Description                     |
| ------------------ | -------------------- | ------------------------------- |
| `getPacketHealth`  | `configPath?`        | Overall audit results           |
| `listCapabilities` | `configPath?`        | Agent + per-secret capabilities |
| `getSecretMeta`    | `key`, `configPath?` | Metadata for one secret         |
| `checkExpiration`  | `key`, `configPath?` | Expiration + rotation status    |

## MCP Resources

| URI                     | Description                        |
| ----------------------- | ---------------------------------- |
| `envpkt://health`       | Credential health (JSON)           |
| `envpkt://capabilities` | Agent + secret capabilities (JSON) |
