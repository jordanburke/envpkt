import type { List, Option } from "functype"
import type { DirectLogger } from "functype-log"

import type { EnvpktConfig, Identity } from "./schema.js"

// Re-export schema-derived types
export type {
  CallbackConfig,
  ConsumerType,
  EnvMeta,
  EnvpktConfig,
  Identity,
  LifecycleConfig,
  SecretMeta,
  ToolsConfig,
} from "./schema.js"

/** @deprecated Use `Identity` instead */
export type AgentIdentity = Identity

// --- Health status unions ---

export type HealthStatus = "healthy" | "degraded" | "critical"

export type SecretStatus = "healthy" | "expiring_soon" | "expired" | "stale" | "missing" | "missing_metadata"

// --- Audit types ---

export type SecretHealth = {
  readonly key: string
  readonly service: Option<string>
  readonly status: SecretStatus
  readonly days_remaining: Option<number>
  readonly rotation_url: Option<string>
  readonly purpose: Option<string>
  readonly created: Option<string>
  readonly expires: Option<string>
  readonly issues: List<string>
  /** If this entry is an alias (from_key), the reference it points at (e.g. "secret.X") */
  readonly alias_of: Option<string>
}

export type AuditResult = {
  readonly status: HealthStatus
  readonly secrets: List<SecretHealth>
  readonly total: number
  readonly healthy: number
  readonly expiring_soon: number
  readonly expired: number
  readonly stale: number
  readonly missing: number
  readonly missing_metadata: number
  readonly orphaned: number
  /** Count of entries that are aliases (from_key). Included in `secrets` but reported separately for visibility. */
  readonly aliases: number
  readonly identity?: Identity
}

// --- Env drift types ---

export type EnvDriftStatus = "default" | "overridden" | "missing"

export type EnvDriftEntry = {
  readonly key: string
  readonly defaultValue: string
  // eslint-disable-next-line functype/prefer-option
  readonly currentValue: string | undefined
  readonly status: EnvDriftStatus
  // eslint-disable-next-line functype/prefer-option
  readonly purpose: string | undefined
  /** If this entry is an alias (from_key), the reference it points at (e.g. "env.X") */
  readonly alias_of: Option<string>
}

export type EnvAuditResult = {
  readonly entries: ReadonlyArray<EnvDriftEntry>
  readonly total: number
  readonly defaults_applied: number
  readonly overridden: number
  readonly missing: number
}

// --- Fleet types ---

export type FleetAgent = {
  readonly path: string
  readonly identity?: Identity
  readonly min_expiry_days?: number
  readonly audit: AuditResult
}

export type FleetHealth = {
  readonly status: HealthStatus
  readonly agents: List<FleetAgent>
  readonly total_agents: number
  readonly total_secrets: number
  readonly expired: number
  readonly expiring_soon: number
}

// --- fnox types ---

export type FnoxSecret = {
  readonly key: string
  readonly profile: Option<string>
}

export type FnoxConfig = {
  readonly secrets: Record<string, unknown>
  readonly profiles: Option<Record<string, unknown>>
}

// --- Error types ---

export type ConfigError =
  | { readonly _tag: "FileNotFound"; readonly path: string }
  | { readonly _tag: "ParseError"; readonly message: string }
  | { readonly _tag: "ValidationError"; readonly errors: List<string> }
  | { readonly _tag: "ReadError"; readonly message: string }

export type FnoxError =
  | { readonly _tag: "FnoxNotFound"; readonly message: string }
  | { readonly _tag: "FnoxCliError"; readonly message: string }
  | { readonly _tag: "FnoxParseError"; readonly message: string }

// --- Config resolution types ---

export type ConfigSource = "flag" | "env" | "cwd" | "search"

export type ResolvedPath = {
  readonly path: string
  readonly source: ConfigSource
}

// --- Catalog / Resolve types ---

export type ResolveOptions = {
  readonly configPath?: string
  readonly output?: string
}

export type ResolveResult = {
  readonly config: EnvpktConfig
  readonly catalogPath?: string
  readonly merged: ReadonlyArray<string>
  readonly overridden: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

export type CatalogError =
  | { readonly _tag: "CatalogNotFound"; readonly path: string }
  | { readonly _tag: "CatalogLoadError"; readonly message: string }
  | { readonly _tag: "SecretNotInCatalog"; readonly key: string; readonly catalogPath: string }
  | { readonly _tag: "MissingSecretsList"; readonly message: string }

// --- Alias types ---

export type AliasTable = {
  /** key → { type: "secret"|"env", targetType, targetKey } for every alias entry */
  readonly entries: ReadonlyMap<
    string,
    { readonly kind: "secret" | "env"; readonly targetKind: "secret" | "env"; readonly targetKey: string }
  >
}

export type AliasError =
  | {
      readonly _tag: "AliasInvalidSyntax"
      readonly key: string
      readonly kind: "secret" | "env"
      readonly value: string
    }
  | { readonly _tag: "AliasTargetMissing"; readonly key: string; readonly target: string }
  | { readonly _tag: "AliasSelfReference"; readonly key: string }
  | { readonly _tag: "AliasChained"; readonly key: string; readonly target: string }
  | {
      readonly _tag: "AliasCrossType"
      readonly key: string
      readonly kind: "secret" | "env"
      readonly targetKind: "secret" | "env"
    }
  | {
      readonly _tag: "AliasValueConflict"
      readonly key: string
      readonly kind: "secret" | "env"
      readonly field: string
    }

// --- Boot types ---

export type BootOptions = {
  readonly configPath?: string
  readonly profile?: string
  readonly inject?: boolean
  readonly failOnExpired?: boolean
  readonly warnOnly?: boolean
  /**
   * Optional diagnostic logger. Defaults to a silent logger (zero overhead).
   * Receives structured trace events at boot resolution decision points
   * (alias validation, sealed phase, fnox phase, alias copy phase). Useful
   * for debugging why a particular secret landed in skipped[] vs injected[].
   */
  readonly logger?: DirectLogger
}

export type BootResult = {
  readonly audit: AuditResult
  readonly injected: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<string>
  readonly secrets: Readonly<Record<string, string>>
  readonly warnings: ReadonlyArray<string>
  readonly envDefaults: Readonly<Record<string, string>>
  readonly overridden: ReadonlyArray<string>
  readonly configPath: string
  readonly configSource: ConfigSource
}

export type BootError =
  | ConfigError
  | FnoxError
  | CatalogError
  | AliasError
  | { readonly _tag: "AuditFailed"; readonly audit: AuditResult; readonly message: string }
  | IdentityError

export type IdentityError =
  | { readonly _tag: "AgeNotFound"; readonly message: string }
  | { readonly _tag: "DecryptFailed"; readonly message: string }
  | { readonly _tag: "IdentityNotFound"; readonly path: string }

export type SealError =
  | { readonly _tag: "AgeNotFound"; readonly message: string }
  | { readonly _tag: "EncryptFailed"; readonly key: string; readonly message: string }
  | { readonly _tag: "DecryptFailed"; readonly key: string; readonly message: string }
  | { readonly _tag: "NoRecipient"; readonly message: string }

// --- Keygen types ---

export type KeygenError =
  | { readonly _tag: "AgeNotFound"; readonly message: string }
  | { readonly _tag: "KeygenFailed"; readonly message: string }
  | { readonly _tag: "KeyExists"; readonly path: string }
  | { readonly _tag: "WriteError"; readonly message: string }
  | { readonly _tag: "ConfigUpdateError"; readonly message: string }

export type KeygenResult = {
  readonly recipient: string
  readonly identityPath: string
  readonly configUpdated: boolean
}

// --- TOML editing types ---

export type TomlEditError =
  | { readonly _tag: "SectionNotFound"; readonly section: string }
  | { readonly _tag: "SectionAlreadyExists"; readonly section: string }
