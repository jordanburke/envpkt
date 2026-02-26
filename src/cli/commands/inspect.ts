import { dirname } from "node:path"

import { resolveConfig } from "../../core/catalog.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import type { SecretDisplay } from "../../core/format.js"
import { maskValue } from "../../core/format.js"
import type { EnvpktConfig, ResolveResult, SecretMeta } from "../../core/types.js"
import { BOLD, CYAN, DIM, formatError, RESET, YELLOW } from "../output.js"

type InspectOptions = {
  readonly config?: string
  readonly format?: string
  readonly resolved?: boolean
  readonly secrets?: boolean
  readonly plaintext?: boolean
}

const printSecretMeta = (meta: SecretMeta, indent: string): void => {
  if (meta.purpose) console.log(`${indent}purpose: ${meta.purpose}`)
  if (meta.capabilities) console.log(`${indent}capabilities: ${DIM}${meta.capabilities.join(", ")}${RESET}`)

  const dateParts: string[] = []
  if (meta.created) dateParts.push(`created: ${meta.created}`)
  if (meta.expires) dateParts.push(`expires: ${meta.expires}`)
  if (dateParts.length > 0) console.log(`${indent}${dateParts.join("  ")}`)

  const opsParts: string[] = []
  if (meta.rotates) opsParts.push(`rotates: ${meta.rotates}`)
  if (meta.rate_limit) opsParts.push(`rate_limit: ${meta.rate_limit}`)
  if (opsParts.length > 0) console.log(`${indent}${opsParts.join("  ")}`)

  if (meta.source) console.log(`${indent}source: ${meta.source}`)
  if (meta.model_hint) console.log(`${indent}model_hint: ${meta.model_hint}`)
  if (meta.rotation_url) console.log(`${indent}rotation_url: ${DIM}${meta.rotation_url}${RESET}`)
  if (meta.required !== undefined) console.log(`${indent}required: ${meta.required}`)
  if (meta.tags) {
    const tagStr = Object.entries(meta.tags)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    console.log(`${indent}tags: ${tagStr}`)
  }
}

type PrintOptions = {
  readonly secrets?: Readonly<Record<string, string>>
  readonly secretDisplay?: SecretDisplay
}

const printConfig = (config: EnvpktConfig, path: string, resolveResult?: ResolveResult, opts?: PrintOptions): void => {
  console.log(`${BOLD}envpkt.toml${RESET} ${DIM}(${path})${RESET}`)
  if (resolveResult?.catalogPath) {
    console.log(`${DIM}Catalog: ${CYAN}${resolveResult.catalogPath}${RESET}`)
  }
  console.log(`version: ${config.version}`)
  console.log("")

  if (config.agent) {
    console.log(`${BOLD}Agent:${RESET} ${config.agent.name}`)
    if (config.agent.consumer) console.log(`  consumer: ${config.agent.consumer}`)
    if (config.agent.description) console.log(`  description: ${config.agent.description}`)
    if (config.agent.capabilities) console.log(`  capabilities: ${config.agent.capabilities.join(", ")}`)
    if (config.agent.expires) console.log(`  expires: ${config.agent.expires}`)
    if (config.agent.services) console.log(`  services: ${config.agent.services.join(", ")}`)
    if (config.agent.secrets) console.log(`  secrets: ${config.agent.secrets.join(", ")}`)
    console.log("")
  }

  console.log(`${BOLD}Secrets:${RESET} ${Object.keys(config.meta).length}`)
  for (const [key, meta] of Object.entries(config.meta)) {
    const secretValue = opts?.secrets?.[key]
    const valueSuffix =
      secretValue !== undefined
        ? ` = ${YELLOW}${(opts?.secretDisplay ?? "encrypted") === "plaintext" ? secretValue : maskValue(secretValue)}${RESET}`
        : ""
    console.log(`  ${BOLD}${key}${RESET} → ${meta.service ?? key}${valueSuffix}`)
    printSecretMeta(meta, "    ")
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

  // Catalog resolution summary
  if (resolveResult?.catalogPath) {
    console.log("")
    console.log(`${BOLD}Catalog Resolution:${RESET}`)
    console.log(`  merged: ${resolveResult.merged.length} keys`)
    if (resolveResult.overridden.length > 0) {
      console.log(`  overridden: ${resolveResult.overridden.join(", ")}`)
    } else {
      console.log(`  overridden: ${DIM}(none)${RESET}`)
    }
    for (const w of resolveResult.warnings) {
      console.log(`  ${YELLOW}warning:${RESET} ${w}`)
    }
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
              const showResolved = options.resolved || !!resolveResult.catalogPath
              const showConfig = showResolved ? resolveResult.config : config

              if (options.format === "json") {
                console.log(JSON.stringify(showConfig, null, 2))
                return
              }

              const printOpts: PrintOptions | undefined = options.secrets
                ? {
                    secrets: Object.fromEntries(
                      Object.keys(showConfig.meta)
                        .filter((key) => process.env[key] !== undefined)
                        .map((key) => [key, process.env[key] as string]),
                    ),
                    secretDisplay: options.plaintext ? "plaintext" : "encrypted",
                  }
                : undefined

              printConfig(showConfig, path, showResolved ? resolveResult : undefined, printOpts)
            },
          )
        },
      )
    },
  )
}
