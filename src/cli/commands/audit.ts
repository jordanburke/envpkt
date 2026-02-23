import { computeAudit } from "../../core/audit.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import type { SecretStatus } from "../../core/types.js"
import { exitCodeForAudit, formatAudit, formatAuditJson, formatError } from "../output.js"

type AuditOptions = {
  readonly config?: string
  readonly format?: string
  readonly expiring?: number
  readonly status?: string
  readonly strict?: boolean
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
        (config) => {
          const audit = computeAudit(config)

          let filtered = audit
          if (options.status) {
            const statusFilter = options.status as SecretStatus
            const filteredSecrets = audit.secrets.filter((s) => s.status === statusFilter)
            filtered = { ...audit, secrets: filteredSecrets }
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
          } else {
            console.log(formatAudit(filtered))
          }

          const code = options.strict ? exitCodeForAudit(audit) : audit.status === "critical" ? 2 : 0
          process.exit(code)
        },
      )
    },
  )
}
