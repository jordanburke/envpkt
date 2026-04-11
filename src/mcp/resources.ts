import type { ReadResourceResult, Resource } from "@modelcontextprotocol/sdk/types.js"
import { Option } from "functype"

import { computeAudit } from "../core/audit.js"
import { loadConfig, resolveConfigPath } from "../core/config.js"
import type { EnvpktConfig } from "../core/types.js"

const loadConfigSafe = (): Option<{ config: EnvpktConfig; path: string }> => {
  const resolved = resolveConfigPath()
  return resolved.fold(
    () => Option.none<{ config: EnvpktConfig; path: string }>(),
    ({ path }) =>
      loadConfig(path).fold(
        () => Option.none<{ config: EnvpktConfig; path: string }>(),
        (config) => Option({ config, path }),
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

const readHealth = (): ReadResourceResult =>
  loadConfigSafe().fold(
    () => ({
      contents: [
        {
          uri: "envpkt://health",
          mimeType: "application/json",
          text: JSON.stringify({ error: "No envpkt.toml found" }),
        },
      ],
    }),
    ({ config, path }) => {
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
    },
  )

const readCapabilities = (): ReadResourceResult =>
  loadConfigSafe().fold(
    () => ({
      contents: [
        {
          uri: "envpkt://capabilities",
          mimeType: "application/json",
          text: JSON.stringify({ error: "No envpkt.toml found" }),
        },
      ],
    }),
    ({ config }) => {
      const agentCapabilities = config.identity?.capabilities ?? []
      const secretCapabilities: Record<string, readonly string[]> = {}

      Object.entries(config.secret ?? {}).forEach(([key, meta]) => {
        if (meta.capabilities && meta.capabilities.length > 0) {
          secretCapabilities[key] = meta.capabilities
        }
      })

      return {
        contents: [
          {
            uri: "envpkt://capabilities",
            mimeType: "application/json",
            text: JSON.stringify(
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
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

const resourceHandlers: Record<string, () => ReadResourceResult> = {
  "envpkt://health": readHealth,
  "envpkt://capabilities": readCapabilities,
}

export const readResource = (uri: string): Option<ReadResourceResult> =>
  Option(resourceHandlers[uri]).map((handler) => handler())
