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
import { BLUE, BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, MAGENTA, RESET, YELLOW } from "../output.js"

type InspectOptions = {
  readonly config?: string
  readonly format?: string
  readonly resolved?: boolean
  readonly secrets?: boolean
  readonly plaintext?: boolean
}

const printSecretMeta = (meta: SecretMeta, indent: string): void => {
  if (meta.purpose) console.log(`${indent}${DIM}purpose:${RESET} ${meta.purpose}`)
  if (meta.comment) console.log(`${indent}${DIM}comment:${RESET} ${DIM}${meta.comment}${RESET}`)
  if (meta.capabilities)
    console.log(
      `${indent}${DIM}capabilities:${RESET} ${meta.capabilities.map((c) => `${MAGENTA}${c}${RESET}`).join(", ")}`,
    )

  const dateParts: string[] = []
  if (meta.created) dateParts.push(`${DIM}created:${RESET} ${BLUE}${meta.created}${RESET}`)
  if (meta.expires) dateParts.push(`${DIM}expires:${RESET} ${YELLOW}${meta.expires}${RESET}`)
  if (dateParts.length > 0) console.log(`${indent}${dateParts.join("  ")}`)

  const opsParts: string[] = []
  if (meta.rotates) opsParts.push(`${DIM}rotates:${RESET} ${CYAN}${meta.rotates}${RESET}`)
  if (meta.rate_limit) opsParts.push(`${DIM}rate_limit:${RESET} ${CYAN}${meta.rate_limit}${RESET}`)
  if (opsParts.length > 0) console.log(`${indent}${opsParts.join("  ")}`)

  if (meta.source) console.log(`${indent}${DIM}source:${RESET} ${BLUE}${meta.source}${RESET}`)
  if (meta.model_hint) console.log(`${indent}${DIM}model_hint:${RESET} ${MAGENTA}${meta.model_hint}${RESET}`)
  if (meta.rotation_url) console.log(`${indent}${DIM}rotation_url:${RESET} ${DIM}${meta.rotation_url}${RESET}`)
  if (meta.required !== undefined)
    console.log(`${indent}${DIM}required:${RESET} ${meta.required ? `${GREEN}true${RESET}` : `${DIM}false${RESET}`}`)
  if (meta.tags) {
    const tagStr = Object.entries(meta.tags)
      .map(([k, v]) => `${CYAN}${k}${RESET}=${DIM}${v}${RESET}`)
      .join(", ")
    console.log(`${indent}${DIM}tags:${RESET} ${tagStr}`)
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
  console.log(`${DIM}version:${RESET} ${config.version}`)
  console.log("")

  if (config.identity) {
    console.log(`${BOLD}Identity:${RESET} ${GREEN}${config.identity.name}${RESET}`)
    if (config.identity.consumer) console.log(`  ${DIM}consumer:${RESET} ${MAGENTA}${config.identity.consumer}${RESET}`)
    if (config.identity.description) console.log(`  ${DIM}description:${RESET} ${config.identity.description}`)
    if (config.identity.capabilities)
      console.log(
        `  ${DIM}capabilities:${RESET} ${config.identity.capabilities.map((c) => `${MAGENTA}${c}${RESET}`).join(", ")}`,
      )
    if (config.identity.expires) console.log(`  ${DIM}expires:${RESET} ${YELLOW}${config.identity.expires}${RESET}`)
    if (config.identity.services)
      console.log(`  ${DIM}services:${RESET} ${config.identity.services.map((s) => `${CYAN}${s}${RESET}`).join(", ")}`)
    if (config.identity.secrets)
      console.log(`  ${DIM}secrets:${RESET} ${config.identity.secrets.map((s) => `${BOLD}${s}${RESET}`).join(", ")}`)
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
      console.log(`  ${BOLD}${key}${RESET} = ${GREEN}"${entry.value}"${RESET}`)
      if (entry.purpose) console.log(`    ${DIM}purpose:${RESET} ${entry.purpose}`)
      if (entry.comment) console.log(`    ${DIM}comment:${RESET} ${DIM}${entry.comment}${RESET}`)
    })
  }

  if (config.lifecycle) {
    console.log("")
    console.log(`${BOLD}Lifecycle:${RESET}`)
    if (config.lifecycle.stale_warning_days !== undefined)
      console.log(`  ${DIM}stale_warning_days:${RESET} ${YELLOW}${config.lifecycle.stale_warning_days}${RESET}`)
    if (config.lifecycle.require_expiration !== undefined)
      console.log(
        `  ${DIM}require_expiration:${RESET} ${config.lifecycle.require_expiration ? `${GREEN}true${RESET}` : `${DIM}false${RESET}`}`,
      )
    if (config.lifecycle.require_service !== undefined)
      console.log(
        `  ${DIM}require_service:${RESET} ${config.lifecycle.require_service ? `${GREEN}true${RESET}` : `${DIM}false${RESET}`}`,
      )
  }

  // Catalog resolution summary
  if (resolveResult?.catalogPath) {
    console.log("")
    console.log(`${BOLD}Catalog Resolution:${RESET}`)
    console.log(`  ${DIM}merged:${RESET} ${GREEN}${resolveResult.merged.length}${RESET} keys`)
    if (resolveResult.overridden.length > 0) {
      console.log(
        `  ${DIM}overridden:${RESET} ${resolveResult.overridden.map((k) => `${YELLOW}${k}${RESET}`).join(", ")}`,
      )
    } else {
      console.log(`  ${DIM}overridden: (none)${RESET}`)
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
