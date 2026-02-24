import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { BOLD, DIM, formatError, RESET } from "../output.js"

type InspectOptions = {
  readonly config?: string
  readonly format?: string
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
          if (options.format === "json") {
            console.log(JSON.stringify(config, null, 2))
            return
          }

          console.log(`${BOLD}envpkt.toml${RESET} ${DIM}(${path})${RESET}`)
          console.log(`version: ${config.version}`)
          console.log("")

          if (config.agent) {
            console.log(`${BOLD}Agent:${RESET} ${config.agent.name}`)
            if (config.agent.consumer) console.log(`  consumer: ${config.agent.consumer}`)
            if (config.agent.description) console.log(`  description: ${config.agent.description}`)
            if (config.agent.capabilities) console.log(`  capabilities: ${config.agent.capabilities.join(", ")}`)
            if (config.agent.expires) console.log(`  expires: ${config.agent.expires}`)
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
        },
      )
    },
  )
}
