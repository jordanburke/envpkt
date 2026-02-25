import { dirname } from "node:path"

import { resolveConfig } from "../../core/catalog.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import type { EnvpktConfig } from "../../core/types.js"
import { BOLD, CYAN, DIM, formatError, RESET } from "../output.js"

type InspectOptions = {
  readonly config?: string
  readonly format?: string
  readonly resolved?: boolean
}

const printConfig = (config: EnvpktConfig, path: string, catalogPath?: string): void => {
  console.log(`${BOLD}envpkt.toml${RESET} ${DIM}(${path})${RESET}`)
  if (catalogPath) {
    console.log(`${DIM}Catalog: ${CYAN}${catalogPath}${RESET}`)
  }
  console.log(`version: ${config.version}`)
  console.log("")

  if (config.agent) {
    console.log(`${BOLD}Agent:${RESET} ${config.agent.name}`)
    if (config.agent.consumer) console.log(`  consumer: ${config.agent.consumer}`)
    if (config.agent.description) console.log(`  description: ${config.agent.description}`)
    if (config.agent.capabilities) console.log(`  capabilities: ${config.agent.capabilities.join(", ")}`)
    if (config.agent.expires) console.log(`  expires: ${config.agent.expires}`)
    if (config.agent.secrets) console.log(`  secrets: ${config.agent.secrets.join(", ")}`)
    console.log("")
  }

  console.log(`${BOLD}Secrets:${RESET} ${Object.keys(config.meta).length}`)
  for (const [key, meta] of Object.entries(config.meta)) {
    console.log(`  ${BOLD}${key}${RESET} → ${meta.service ?? key}`)
    if (meta.purpose) console.log(`    purpose: ${meta.purpose}`)
    if (meta.created) console.log(`    created: ${meta.created}`)
    if (meta.expires) console.log(`    expires: ${meta.expires}`)
    if (meta.source) console.log(`    source: ${meta.source}`)
  }

  if (config.lifecycle) {
    console.log("")
    console.log(`${BOLD}Lifecycle:${RESET}`)
    if (config.lifecycle.stale_warning_days !== undefined)
      console.log(`  stale_warning_days: ${config.lifecycle.stale_warning_days}`)
    if (config.lifecycle.require_expiration !== undefined)
      console.log(`  require_expiration: ${config.lifecycle.require_expiration}`)
    if (config.lifecycle.require_service !== undefined)
      console.log(`  require_service: ${config.lifecycle.require_service}`)
  }
}

export const runInspect = (options: InspectOptions): void => {
  const configPath = resolveConfigPath(options.config)

  configPath.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    (path) => {
      const result = loadConfig(path)

      result.fold(
        (err) => {
          console.error(formatError(err))
          process.exit(2)
        },
        (config) => {
          const configDir = dirname(path)
          const resolved = resolveConfig(config, configDir)

          resolved.fold(
            (err) => {
              console.error(formatError(err))
              process.exit(2)
            },
            (resolveResult) => {
              const showConfig = options.resolved || resolveResult.catalogPath ? resolveResult.config : config

              if (options.format === "json") {
                console.log(JSON.stringify(showConfig, null, 2))
                return
              }

              printConfig(showConfig, path, resolveResult.catalogPath)
            },
          )
        },
      )
    },
  )
}
