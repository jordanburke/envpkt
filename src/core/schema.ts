import { FormatRegistry, type Static, Type } from "@sinclair/typebox"

// Register format validators for TypeBox runtime checking
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const URI_RE = /^https?:\/\/.+/

if (!FormatRegistry.Has("date")) {
  FormatRegistry.Set("date", (v) => DATE_RE.test(v))
}
if (!FormatRegistry.Has("uri")) {
  FormatRegistry.Set("uri", (v) => URI_RE.test(v))
}

// --- Reusable enums ---

export const ConsumerType = Type.Union(
  [Type.Literal("agent"), Type.Literal("service"), Type.Literal("developer"), Type.Literal("ci")],
  { description: "Classification of the agent's consumer type" },
)
export type ConsumerType = Static<typeof ConsumerType>

// --- Agent Identity ---

export const AgentIdentitySchema = Type.Object(
  {
    name: Type.String({ description: "Agent display name" }),
    consumer: Type.Optional(ConsumerType),
    description: Type.Optional(Type.String({ description: "Agent description or role" })),
    capabilities: Type.Optional(Type.Array(Type.String(), { description: "List of capabilities this agent provides" })),
    expires: Type.Optional(
      Type.String({ format: "date", description: "Agent credential expiration date (YYYY-MM-DD)" }),
    ),
    services: Type.Optional(Type.Array(Type.String(), { description: "Service dependencies for this agent" })),
    identity: Type.Optional(
      Type.String({ description: "Path to encrypted agent key file (relative to config directory)" }),
    ),
    recipient: Type.Optional(Type.String({ description: "Agent's age public key for encryption" })),
  },
  { description: "Identity and capabilities of the AI agent using this envpkt" },
)
export type AgentIdentity = Static<typeof AgentIdentitySchema>

// --- Secret Metadata ---

export const SecretMetaSchema = Type.Object(
  {
    // Tier 1: scan-first
    service: Type.Optional(Type.String({ description: "Service or system this secret authenticates to" })),
    expires: Type.Optional(Type.String({ format: "date", description: "Date the secret expires (YYYY-MM-DD)" })),
    rotation_url: Type.Optional(
      Type.String({ format: "uri", description: "URL or reference for secret rotation procedure" }),
    ),
    // Tier 2: context
    purpose: Type.Optional(Type.String({ description: "Why this secret exists and what it enables" })),
    capabilities: Type.Optional(
      Type.Array(Type.String(), { description: "What operations this secret grants (e.g. read, write, admin)" }),
    ),
    created: Type.Optional(
      Type.String({ format: "date", description: "Date the secret was provisioned (YYYY-MM-DD)" }),
    ),
    // Tier 3: operational
    rotates: Type.Optional(Type.String({ description: "Rotation schedule (e.g. '90d', 'quarterly')" })),
    rate_limit: Type.Optional(Type.String({ description: "Rate limit or quota info (e.g. '1000/min')" })),
    model_hint: Type.Optional(Type.String({ description: "Suggested model or tier for this credential" })),
    source: Type.Optional(Type.String({ description: "Where the secret value originates (e.g. 'vault', 'ci')" })),
    // Tier 4: enforcement/extensibility
    required: Type.Optional(Type.Boolean({ description: "Whether this secret is required for operation" })),
    tags: Type.Optional(
      Type.Record(Type.String(), Type.String(), { description: "Key-value tags for grouping and filtering" }),
    ),
  },
  { description: "Metadata about a single secret" },
)
export type SecretMeta = Static<typeof SecretMetaSchema>

// --- Lifecycle Config ---

export const LifecycleConfigSchema = Type.Object(
  {
    stale_warning_days: Type.Optional(
      Type.Number({ default: 90, description: "Days since creation to consider a secret stale" }),
    ),
    require_expiration: Type.Optional(Type.Boolean({ default: false, description: "Require expires on all secrets" })),
    require_service: Type.Optional(Type.Boolean({ default: false, description: "Require service on all secrets" })),
  },
  { description: "Policy configuration for credential lifecycle management" },
)
export type LifecycleConfig = Static<typeof LifecycleConfigSchema>

// --- Callback Config ---

export const CallbackConfigSchema = Type.Object(
  {
    on_expiring: Type.Optional(Type.String({ description: "Command or webhook to invoke when secrets are expiring" })),
    on_expired: Type.Optional(Type.String({ description: "Command or webhook to invoke when secrets have expired" })),
    on_audit_fail: Type.Optional(Type.String({ description: "Command or webhook on audit failure" })),
  },
  { description: "Automation callbacks for lifecycle events" },
)
export type CallbackConfig = Static<typeof CallbackConfigSchema>

// --- Tools Config ---

export const ToolsConfigSchema = Type.Record(Type.String(), Type.Unknown(), {
  description: "Tool integration configuration — open namespace for third-party extensions",
})
export type ToolsConfig = Static<typeof ToolsConfigSchema>

// --- Top-level EnvpktConfig ---

export const EnvpktConfigSchema = Type.Object(
  {
    version: Type.Number({ description: "Schema version number", default: 1 }),
    agent: Type.Optional(AgentIdentitySchema),
    meta: Type.Record(Type.String(), SecretMetaSchema, {
      description: "Per-secret metadata keyed by secret name",
    }),
    lifecycle: Type.Optional(LifecycleConfigSchema),
    callbacks: Type.Optional(CallbackConfigSchema),
    tools: Type.Optional(ToolsConfigSchema),
  },
  {
    $id: "envpkt",
    title: "envpkt configuration",
    description: "Credential lifecycle and fleet management configuration for AI agents",
  },
)
export type EnvpktConfig = Static<typeof EnvpktConfigSchema>
