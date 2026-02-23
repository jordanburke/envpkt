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
            if (config.agent.role) console.log(`  role: ${config.agent.role}`)
            if (config.agent.capabilities) console.log(`  capabilities: ${config.agent.capabilities.join(", ")}`)
            if (config.agent.expires) console.log(`  expires: ${config.agent.expires}`)
            console.log("")
          }

          console.log(`${BOLD}Secrets:${RESET} ${Object.keys(config.meta).length}`)
          for (const [key, meta] of Object.entries(config.meta)) {
            console.log(`  ${BOLD}${key}${RESET} → ${meta.service}`)
            if (meta.purpose) console.log(`    purpose: ${meta.purpose}`)
            if (meta.created) console.log(`    created: ${meta.created}`)
            if (meta.expires) console.log(`    expires: ${meta.expires}`)
            if (meta.provisioner) console.log(`    provisioner: ${meta.provisioner}`)
          }

          if (config.lifecycle) {
            console.log("")
            console.log(`${BOLD}Lifecycle:${RESET}`)
            if (config.lifecycle.warn_before_days !== undefined)
              console.log(`  warn_before_days: ${config.lifecycle.warn_before_days}`)
            if (config.lifecycle.stale_after_days !== undefined)
              console.log(`  stale_after_days: ${config.lifecycle.stale_after_days}`)
          }
        },
      )
    },
  )
}
