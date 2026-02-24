import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js"

import { computeAudit } from "../core/audit.js"
import { loadConfig, resolveConfigPath } from "../core/config.js"
import type { EnvpktConfig } from "../core/types.js"

const loadConfigSafe = (): { config: EnvpktConfig; path: string } | undefined => {
  const resolved = resolveConfigPath()
  return resolved.fold(
    () => undefined,
    (path) =>
      loadConfig(path).fold(
        () => undefined,
        (config) => ({ config, path }),
      ),
  )
}

export const resourceDefinitions: readonly Resource[] = [
  {
    uri: "envpkt://health",
    name: "Credential Health",
    description: "Current health status of the envpkt credential packet",
    mimeType: "application/json",
  },
  {
    uri: "envpkt://capabilities",
    name: "Agent Capabilities",
    description: "Capabilities declared by the agent and per-secret capability grants",
    mimeType: "application/json",
  },
]

const readHealth = (): ReadResourceResult => {
  const loaded = loadConfigSafe()
  if (!loaded) {
    return {
      contents: [
        {
          uri: "envpkt://health",
          mimeType: "application/json",
          text: JSON.stringify({ error: "No envpkt.toml found" }),
        },
      ],
    }
  }

  const { config, path } = loaded
  const audit = computeAudit(config)

  return {
    contents: [
      {
        uri: "envpkt://health",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            path,
            status: audit.status,
            total: audit.total,
            healthy: audit.healthy,
            expiring_soon: audit.expiring_soon,
            expired: audit.expired,
            stale: audit.stale,
            missing: audit.missing,
          },
          null,
          2,
        ),
      },
    ],
  }
}

const readCapabilities = (): ReadResourceResult => {
  const loaded = loadConfigSafe()
  if (!loaded) {
    return {
      contents: [
        {
          uri: "envpkt://capabilities",
          mimeType: "application/json",
          text: JSON.stringify({ error: "No envpkt.toml found" }),
        },
      ],
    }
  }

  const { config } = loaded
  const agentCapabilities = config.agent?.capabilities ?? []
  const secretCapabilities: Record<string, readonly string[]> = {}

  for (const [key, meta] of Object.entries(config.meta)) {
    if (meta.capabilities && meta.capabilities.length > 0) {
      secretCapabilities[key] = meta.capabilities
    }
  }

  return {
    contents: [
      {
        uri: "envpkt://capabilities",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            agent: config.agent
              ? {
                  name: config.agent.name,
                  consumer: config.agent.consumer,
                  description: config.agent.description,
                  capabilities: agentCapabilities,
                }
              : null,
            secrets: secretCapabilities,
          },
          null,
          2,
        ),
      },
    ],
  }
}

const resourceHandlers: Record<string, () => ReadResourceResult> = {
  "envpkt://health": readHealth,
  "envpkt://capabilities": readCapabilities,
}

export const readResource = (uri: string): ReadResourceResult | undefined => {
  const handler = resourceHandlers[uri]
  return handler?.()
}
