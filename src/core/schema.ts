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
  [Type.Literal("api"), Type.Literal("database"), Type.Literal("saas"), Type.Literal("infra"), Type.Literal("other")],
  { description: "Classification of the secret's consumer service" },
)
export type ConsumerType = Static<typeof ConsumerType>

// --- Agent Identity ---

export const AgentIdentitySchema = Type.Object(
  {
    name: Type.String({ description: "Agent display name" }),
    role: Type.Optional(Type.String({ description: "Agent role or function" })),
    capabilities: Type.Optional(Type.Array(Type.String(), { description: "List of capabilities this agent provides" })),
    expires: Type.Optional(
      Type.String({ format: "date", description: "Agent credential expiration date (YYYY-MM-DD)" }),
    ),
  },
  { description: "Identity and capabilities of the AI agent using this envpkt" },
)
export type AgentIdentity = Static<typeof AgentIdentitySchema>

// --- Secret Metadata ---

export const SecretMetaSchema = Type.Object(
  {
    // What
    service: Type.String({ description: "Service or system this secret authenticates to" }),
    consumer: Type.Optional(ConsumerType),
    // Where
    env_var: Type.Optional(Type.String({ description: "Environment variable name where the secret is injected" })),
    vault_path: Type.Optional(Type.String({ description: "Path in secret manager (e.g. vault, fnox)" })),
    // Why
    purpose: Type.Optional(Type.String({ description: "Why this secret exists and what it enables" })),
    capabilities: Type.Optional(
      Type.Array(Type.String(), { description: "What operations this secret grants (e.g. read, write, admin)" }),
    ),
    // When
    created: Type.Optional(
      Type.String({ format: "date", description: "Date the secret was provisioned (YYYY-MM-DD)" }),
    ),
    expires: Type.Optional(Type.String({ format: "date", description: "Date the secret expires (YYYY-MM-DD)" })),
    rotation_url: Type.Optional(
      Type.String({ format: "uri", description: "URL or reference for secret rotation procedure" }),
    ),
    // How
    provisioner: Type.Optional(
      Type.Union([Type.Literal("manual"), Type.Literal("fnox"), Type.Literal("vault"), Type.Literal("ci")], {
        description: "How this secret is provisioned",
      }),
    ),
    // Additional
    tags: Type.Optional(Type.Array(Type.String(), { description: "Freeform tags for grouping and filtering" })),
  },
  { description: "Metadata about a single secret — answers What/Where/Why/When/How" },
)
export type SecretMeta = Static<typeof SecretMetaSchema>

// --- Lifecycle Config ---

export const LifecycleConfigSchema = Type.Object(
  {
    warn_before_days: Type.Optional(
      Type.Number({ default: 30, description: "Days before expiration to trigger warnings" }),
    ),
    stale_after_days: Type.Optional(
      Type.Number({ default: 365, description: "Days since creation to consider a secret stale" }),
    ),
    require_rotation_url: Type.Optional(
      Type.Boolean({ default: false, description: "Require rotation_url on all secrets" }),
    ),
    require_purpose: Type.Optional(Type.Boolean({ default: false, description: "Require purpose on all secrets" })),
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

export const ToolsConfigSchema = Type.Object(
  {
    fnox: Type.Optional(Type.Boolean({ default: true, description: "Enable fnox integration" })),
    mcp: Type.Optional(Type.Boolean({ default: true, description: "Enable MCP server capabilities" })),
  },
  { description: "Tool integration toggles" },
)
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
