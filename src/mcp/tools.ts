import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Option } from "functype"

import { computeAudit, computeEnvAudit } from "../core/audit.js"
import { loadConfig, resolveConfigPath } from "../core/config.js"
import type { EnvpktConfig } from "../core/types.js"

type ToolDef = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties?: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

const textResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
})

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
})

type LoadedConfig = { readonly ok: true; readonly config: EnvpktConfig; readonly path: string }
type LoadError = { readonly ok: false; readonly result: CallToolResult }

const loadConfigForTool = (configPath: Option<string>): LoadedConfig | LoadError => {
  const resolved = resolveConfigPath(
    configPath.fold(
      () => undefined,
      (v) => v,
    ),
  )
  return resolved.fold<LoadedConfig | LoadError>(
    (err) => ({
      ok: false,
      result: errorResult(`Config error: ${err._tag} — ${err._tag === "FileNotFound" ? err.path : ""}`),
    }),
    ({ path }) =>
      loadConfig(path).fold<LoadedConfig | LoadError>(
        (err) => ({
          ok: false,
          result: errorResult(
            `Config error: ${err._tag} — ${err._tag === "ValidationError" ? err.errors.toArray().join(", ") : ""}`,
          ),
        }),
        (config) => ({ ok: true, config, path }),
      ),
  )
}

// --- Tool definitions ---

export const toolDefinitions: readonly ToolDef[] = [
  {
    name: "getPacketHealth",
    description:
      "Get overall health status of the envpkt credential packet — returns audit results including secret statuses, expiration info, and issues",
    inputSchema: {
      type: "object",
      properties: {
        configPath: { type: "string", description: "Optional path to envpkt.toml" },
      },
    },
  },
  {
    name: "listCapabilities",
    description: "List capabilities declared by the agent and per-secret capabilities",
    inputSchema: {
      type: "object",
      properties: {
        configPath: { type: "string", description: "Optional path to envpkt.toml" },
      },
    },
  },
  {
    name: "getSecretMeta",
    description:
      "Get metadata for a specific secret by key name — returns service, purpose, expiration, provisioner, and other five-W details",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Secret key name to look up" },
        configPath: { type: "string", description: "Optional path to envpkt.toml" },
      },
      required: ["key"],
    },
  },
  {
    name: "checkExpiration",
    description: "Check expiration status of a specific secret — returns days remaining and whether it needs rotation",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Secret key name to check" },
        configPath: { type: "string", description: "Optional path to envpkt.toml" },
      },
      required: ["key"],
    },
  },
  {
    name: "getEnvMeta",
    description:
      "Get metadata for environment defaults — returns configured default values, purposes, and current drift status",
    inputSchema: {
      type: "object",
      properties: {
        configPath: { type: "string", description: "Optional path to envpkt.toml" },
      },
    },
  },
] as const

const configPathArg = (args: Record<string, unknown>): Option<string> =>
  Option(typeof args.configPath === "string" ? args.configPath : null)

// --- Tool handlers ---

const handleGetPacketHealth = (args: Record<string, unknown>): CallToolResult => {
  const loaded = loadConfigForTool(configPathArg(args))
  if (!loaded.ok) return loaded.result

  const { config, path } = loaded
  const audit = computeAudit(config)

  const secretDetails = audit.secrets.toArray().map((s) => ({
    key: s.key,
    service: s.service.fold(
      () => null,
      (sv) => sv,
    ),
    status: s.status,
    days_remaining: s.days_remaining.fold(
      () => null,
      (d) => d,
    ),
    rotation_url: s.rotation_url.fold(
      () => null,
      (u) => u,
    ),
    alias_of: s.alias_of.fold(
      () => null,
      (a) => a,
    ),
    issues: s.issues.toArray(),
  }))

  return textResult(
    JSON.stringify(
      {
        path,
        status: audit.status,
        total: audit.total,
        healthy: audit.healthy,
        expiring_soon: audit.expiring_soon,
        expired: audit.expired,
        stale: audit.stale,
        missing: audit.missing,
        aliases: audit.aliases,
        secrets: secretDetails,
      },
      null,
      2,
    ),
  )
}

const handleListCapabilities = (args: Record<string, unknown>): CallToolResult => {
  const loaded = loadConfigForTool(configPathArg(args))
  if (!loaded.ok) return loaded.result

  const { config } = loaded

  const agentCapabilities = config.identity?.capabilities ?? []
  const secretCapabilities: Record<string, readonly string[]> = {}

  Object.entries(config.secret ?? {}).forEach(([key, meta]) => {
    if (meta.capabilities && meta.capabilities.length > 0) {
      secretCapabilities[key] = meta.capabilities
    }
  })

  return textResult(
    JSON.stringify(
      {
        identity: config.identity
          ? {
              name: config.identity.name,
              consumer: config.identity.consumer,
              description: config.identity.description,
              capabilities: agentCapabilities,
            }
          : null,
        secrets: secretCapabilities,
        env_defaults: Object.keys(config.env ?? {}).length,
      },
      null,
      2,
    ),
  )
}

const handleGetSecretMeta = (args: Record<string, unknown>): CallToolResult => {
  const key = args.key as string
  if (!key) return errorResult("Missing required argument: key")

  const loaded = loadConfigForTool(configPathArg(args))
  if (!loaded.ok) return loaded.result

  const { config } = loaded
  const secretEntries = config.secret ?? {}
  return Option(secretEntries[key]).fold(
    () => errorResult(`Secret not found: ${key}`),
    (meta) => {
      const { encrypted_value: _, from_key: fromKey, ...rest } = meta
      // If this entry is an alias, merge target metadata for a complete view,
      // then stamp alias_of so the caller knows the relationship.
      if (fromKey !== undefined) {
        const target = Option(fromKey.match(/^secret\.(.+)$/)?.[1]).flatMap((k) => Option(secretEntries[k]))
        return target.fold(
          () => textResult(JSON.stringify({ key, ...rest, alias_of: fromKey }, null, 2)),
          (t) => {
            const { encrypted_value: __, from_key: ___, ...targetRest } = t
            return textResult(JSON.stringify({ key, ...targetRest, ...rest, alias_of: fromKey }, null, 2))
          },
        )
      }
      return textResult(JSON.stringify({ key, ...rest }, null, 2))
    },
  )
}

const handleCheckExpiration = (args: Record<string, unknown>): CallToolResult => {
  const key = args.key as string
  if (!key) return errorResult("Missing required argument: key")

  const loaded = loadConfigForTool(configPathArg(args))
  if (!loaded.ok) return loaded.result

  const { config } = loaded
  const audit = computeAudit(config)
  const secret = audit.secrets.find((s) => s.key === key)

  return secret.fold(
    () => errorResult(`Secret not found: ${key}`),
    (s) =>
      textResult(
        JSON.stringify(
          {
            key: s.key,
            status: s.status,
            days_remaining: s.days_remaining.fold(
              () => null,
              (d) => d,
            ),
            expires: s.expires.fold(
              () => null,
              (e) => e,
            ),
            rotation_url: s.rotation_url.fold(
              () => null,
              (u) => u,
            ),
            needs_rotation: s.status === "expired" || s.status === "expiring_soon",
            issues: s.issues.toArray(),
          },
          null,
          2,
        ),
      ),
  )
}

const handleGetEnvMeta = (args: Record<string, unknown>): CallToolResult => {
  const loaded = loadConfigForTool(configPathArg(args))
  if (!loaded.ok) return loaded.result

  const { config } = loaded
  const envAudit = computeEnvAudit(config)

  return textResult(JSON.stringify(envAudit, null, 2))
}

const handlers: Record<string, (args: Record<string, unknown>) => CallToolResult> = {
  getPacketHealth: handleGetPacketHealth,
  listCapabilities: handleListCapabilities,
  getSecretMeta: handleGetSecretMeta,
  checkExpiration: handleCheckExpiration,
  getEnvMeta: handleGetEnvMeta,
}

export const callTool = (name: string, args: Record<string, unknown>): CallToolResult =>
  Option(handlers[name]).fold(
    () => errorResult(`Unknown tool: ${name}`),
    (handler) => handler(args),
  )
