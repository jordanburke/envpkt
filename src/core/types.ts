import type { List, Option } from "functype"

// Re-export schema-derived types
export type {
  AgentIdentity,
  CallbackConfig,
  ConsumerType,
  EnvpktConfig,
  LifecycleConfig,
  SecretMeta,
  ToolsConfig,
} from "./schema.js"

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
  readonly agent?: import("./schema.js").AgentIdentity
}

// --- Fleet types ---

export type FleetAgent = {
  readonly path: string
  readonly agent?: import("./schema.js").AgentIdentity
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

// --- Catalog / Resolve types ---

export type ResolveOptions = {
  readonly configPath?: string
  readonly output?: string
}

export type ResolveResult = {
  readonly config: import("./schema.js").EnvpktConfig
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

// --- Boot types ---

export type BootOptions = {
  readonly configPath?: string
  readonly profile?: string
  readonly inject?: boolean
  readonly failOnExpired?: boolean
  readonly warnOnly?: boolean
}

export type BootResult = {
  readonly audit: AuditResult
  readonly injected: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<string>
  readonly secrets: Readonly<Record<string, string>>
  readonly warnings: ReadonlyArray<string>
}

export type BootError =
  | ConfigError
  | FnoxError
  | CatalogError
  | { readonly _tag: "AuditFailed"; readonly audit: AuditResult; readonly message: string }
  | IdentityError

export type IdentityError =
  | { readonly _tag: "AgeNotFound"; readonly message: string }
  | { readonly _tag: "DecryptFailed"; readonly message: string }
  | { readonly _tag: "IdentityNotFound"; readonly path: string }
