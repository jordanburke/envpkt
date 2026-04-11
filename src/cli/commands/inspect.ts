import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Option } from "functype"

import { resolveConfig } from "../../core/catalog.js"
import { expandPath, loadConfig, resolveConfigPath } from "../../core/config.js"
import type { SecretDisplay } from "../../core/format.js"
import { maskValue } from "../../core/format.js"
import { resolveKeyPath } from "../../core/keygen.js"
import { unsealSecrets } from "../../core/seal.js"
import type { EnvpktConfig, ResolveResult, SecretMeta } from "../../core/types.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, RESET, YELLOW } from "../output.js"

type InspectOptions = {
  readonly config?: string
  readonly format?: string
  readonly resolved?: boolean
  readonly secrets?: boolean
  readonly plaintext?: boolean
}

const printSecretMeta = (meta: SecretMeta, indent: string): void => {
  if (meta.purpose) console.log(`${indent}purpose: ${meta.purpose}`)
  if (meta.comment) console.log(`${indent}comment: ${DIM}${meta.comment}${RESET}`)
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

  if (config.identity) {
    console.log(`${BOLD}Identity:${RESET} ${config.identity.name}`)
    if (config.identity.consumer) console.log(`  consumer: ${config.identity.consumer}`)
    if (config.identity.description) console.log(`  description: ${config.identity.description}`)
    if (config.identity.capabilities) console.log(`  capabilities: ${config.identity.capabilities.join(", ")}`)
    if (config.identity.expires) console.log(`  expires: ${config.identity.expires}`)
    if (config.identity.services) console.log(`  services: ${config.identity.services.join(", ")}`)
    if (config.identity.secrets) console.log(`  secrets: ${config.identity.secrets.join(", ")}`)
    console.log("")
  }

  const secretEntries = config.secret ?? {}
  console.log(`${BOLD}Secrets:${RESET} ${Object.keys(secretEntries).length}`)
  Object.entries(secretEntries).forEach(([key, meta]) => {
    const valueSuffix = Option(opts?.secrets?.[key]).fold(
      () => "",
      (secretValue) =>
        ` = ${YELLOW}${(opts?.secretDisplay ?? "encrypted") === "plaintext" ? secretValue : maskValue(secretValue)}${RESET}`,
    )
    const sealedTag = meta.encrypted_value ? ` ${CYAN}[sealed]${RESET}` : ""
    console.log(`  ${BOLD}${key}${RESET} → ${meta.service ?? key}${sealedTag}${valueSuffix}`)
    printSecretMeta(meta, "    ")
  })

  // Environment Defaults
  const envEntries = config.env ?? {}
  const envKeys = Object.keys(envEntries)
  if (envKeys.length > 0) {
    console.log("")
    console.log(`${BOLD}Environment Defaults:${RESET} ${envKeys.length}`)
    Object.entries(envEntries).forEach(([key, entry]) => {
      console.log(`  ${BOLD}${key}${RESET} = "${entry.value}"`)
      if (entry.purpose) console.log(`    purpose: ${entry.purpose}`)
      if (entry.comment) console.log(`    comment: ${DIM}${entry.comment}${RESET}`)
    })
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
    resolveResult.warnings.forEach((w) => {
      console.log(`  ${YELLOW}warning:${RESET} ${w}`)
    })
  }
}

export const runInspect = (options: InspectOptions): void => {
  const configPath = resolveConfigPath(options.config)

  configPath.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    ({ path, source }) => {
      const sourceMsg = formatConfigSource(path, source)
      if (sourceMsg) console.error(sourceMsg)
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
              const showResolved = options.resolved ?? !!resolveResult.catalogPath
              const showConfig = showResolved ? resolveResult.config : config

              if (options.format === "json") {
                console.log(JSON.stringify(showConfig, null, 2))
                return
              }

              const showSecrets = showConfig.secret ?? {}
              const printOpts: PrintOptions | undefined = options.secrets
                ? (() => {
                    // Decrypt sealed values from the toml
                    const sealedEntries = Object.fromEntries(
                      Object.entries(showSecrets).filter(([, meta]) => meta.encrypted_value),
                    )

                    const secrets: Record<string, string> =
                      Object.keys(sealedEntries).length > 0
                        ? (() => {
                            const identityPath = showConfig.identity?.key_file
                              ? resolve(configDir, expandPath(showConfig.identity.key_file))
                              : (() => {
                                  const defaultPath = resolveKeyPath()
                                  return existsSync(defaultPath) ? defaultPath : undefined
                                })()

                            if (!identityPath) return {}

                            return unsealSecrets(sealedEntries, identityPath).fold(
                              (err) => {
                                console.error(
                                  `${YELLOW}Warning:${RESET} Could not decrypt sealed secrets: ${err.message}`,
                                )
                                return {} as Record<string, string>
                              },
                              (d) => d,
                            )
                          })()
                        : {}

                    return {
                      secrets,
                      secretDisplay: options.plaintext ? "plaintext" : "encrypted",
                    } satisfies PrintOptions
                  })()
                : undefined

              printConfig(showConfig, path, showResolved ? resolveResult : undefined, printOpts)
            },
          )
        },
      )
    },
  )
}
