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

export type SecretStatus = "healthy" | "expiring_soon" | "expired" | "stale" | "missing"

// --- Audit types ---

export type SecretHealth = {
  readonly key: string
  readonly service: string
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
}

// --- Fleet types ---

export type FleetAgent = {
  readonly path: string
  readonly name: Option<string>
  readonly role: Option<string>
  readonly audit: AuditResult
}

export type FleetHealth = {
  readonly status: HealthStatus
  readonly agents: List<FleetAgent>
  readonly total_agents: number
  readonly total_secrets: number
  readonly critical_count: number
  readonly degraded_count: number
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
