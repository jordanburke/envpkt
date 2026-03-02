import { dirname } from "node:path"

import { computeAudit, computeEnvAudit } from "../../core/audit.js"
import { resolveConfig } from "../../core/catalog.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import type { EnvpktConfig, SecretStatus } from "../../core/types.js"
import {
  BOLD,
  CYAN,
  DIM,
  exitCodeForAudit,
  formatAudit,
  formatAuditJson,
  formatAuditMinimal,
  formatError,
  GREEN,
  RED,
  RESET,
  YELLOW,
} from "../output.js"

type AuditOptions = {
  readonly config?: string
  readonly format?: string
  readonly expiring?: number
  readonly status?: string
  readonly strict?: boolean
  readonly all?: boolean
  readonly envOnly?: boolean
  readonly sealed?: boolean
  readonly external?: boolean
}

export const runAudit = (options: AuditOptions): void => {
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
        (rawConfig) => {
          const configDir = dirname(path)
          const resolved = resolveConfig(rawConfig, configDir)

          resolved.fold(
            (err) => {
              console.error(formatError(err))
              process.exit(2)
            },
            (resolveResult) => {
              if (resolveResult.catalogPath) {
                console.log(`${DIM}Catalog: ${CYAN}${resolveResult.catalogPath}${RESET}`)
              }
              runAuditOnConfig(resolveResult.config, options)
            },
          )
        },
      )
    },
  )
}

const formatEnvAuditTable = (config: EnvpktConfig): void => {
  const envAudit = computeEnvAudit(config)

  if (envAudit.total === 0) {
    console.log(`${DIM}No [env.*] entries configured.${RESET}`)
    return
  }

  console.log(`\n${BOLD}Environment Defaults${RESET} (${envAudit.total} entries)`)

  for (const entry of envAudit.entries) {
    const statusIcon =
      entry.status === "default"
        ? `${GREEN}=${RESET}`
        : entry.status === "overridden"
          ? `${YELLOW}~${RESET}`
          : `${RED}!${RESET}`
    const statusLabel =
      entry.status === "default"
        ? `${DIM}using default${RESET}`
        : entry.status === "overridden"
          ? `${YELLOW}overridden${RESET} (${entry.currentValue})`
          : `${RED}not set${RESET}`
    console.log(`  ${statusIcon} ${BOLD}${entry.key}${RESET} = "${entry.defaultValue}" ${statusLabel}`)
  }
}

const formatEnvAuditJson = (config: EnvpktConfig): string => {
  const envAudit = computeEnvAudit(config)
  return JSON.stringify(envAudit, null, 2)
}

const runAuditOnConfig = (config: EnvpktConfig, options: AuditOptions): void => {
  // --env-only: show only env defaults drift
  if (options.envOnly) {
    if (options.format === "json") {
      console.log(formatEnvAuditJson(config))
    } else {
      formatEnvAuditTable(config)
    }
    process.exit(0)
    return
  }

  const audit = computeAudit(config)

  let filtered = audit

  // --sealed: filter to secrets with encrypted_value
  if (options.sealed) {
    const secretEntries = config.secret ?? {}
    const filteredSecrets = audit.secrets.filter((s) => !!secretEntries[s.key]?.encrypted_value)
    filtered = { ...audit, secrets: filteredSecrets }
  }

  // --external: filter to secrets without encrypted_value
  if (options.external) {
    const secretEntries = config.secret ?? {}
    const filteredSecrets = audit.secrets.filter((s) => !secretEntries[s.key]?.encrypted_value)
    filtered = { ...audit, secrets: filteredSecrets }
  }

  if (options.status) {
    const statusFilter = options.status as SecretStatus
    const filteredSecrets = filtered.secrets.filter((s) => s.status === statusFilter)
    filtered = { ...filtered, secrets: filteredSecrets }
  }
  if (options.expiring !== undefined) {
    const days = options.expiring
    const filteredSecrets = filtered.secrets.filter((s) =>
      s.days_remaining.fold(
        () => false,
        (d) => d >= 0 && d <= days,
      ),
    )
    filtered = { ...filtered, secrets: filteredSecrets }
  }

  if (options.format === "json") {
    console.log(formatAuditJson(filtered))
  } else if (options.format === "minimal") {
    console.log(formatAuditMinimal(filtered))
  } else {
    console.log(formatAudit(filtered))
  }

  // --all: also show env defaults
  if (options.all) {
    if (options.format === "json") {
      console.log(formatEnvAuditJson(config))
    } else {
      formatEnvAuditTable(config)
    }
  }

  const code = options.strict ? exitCodeForAudit(audit) : audit.status === "critical" ? 2 : 0
  process.exit(code)
}
