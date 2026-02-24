import type { AuditResult, FleetHealth, HealthStatus, SecretHealth } from "../core/types.js"

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"

const statusColor = (status: HealthStatus): string => {
  switch (status) {
    case "healthy":
      return GREEN
    case "degraded":
      return YELLOW
    case "critical":
      return RED
  }
}

const statusIcon = (status: HealthStatus): string => {
  switch (status) {
    case "healthy":
      return `${GREEN}✓${RESET}`
    case "degraded":
      return `${YELLOW}⚠${RESET}`
    case "critical":
      return `${RED}✗${RESET}`
  }
}

const secretStatusIcon = (status: string): string => {
  switch (status) {
    case "healthy":
      return `${GREEN}✓${RESET}`
    case "expiring_soon":
      return `${YELLOW}⚠${RESET}`
    case "expired":
      return `${RED}✗${RESET}`
    case "stale":
      return `${YELLOW}○${RESET}`
    case "missing":
      return `${RED}?${RESET}`
    case "missing_metadata":
      return `${YELLOW}!${RESET}`
    default:
      return " "
  }
}

export const formatSecretRow = (secret: SecretHealth): string => {
  const icon = secretStatusIcon(secret.status)
  const days = secret.days_remaining.fold(
    () => "",
    (d) => `${d}d`,
  )
  const rotation = secret.rotation_url.fold(
    () => "",
    (url) => `${DIM}${url}${RESET}`,
  )
  const svc = secret.service.fold(
    () => secret.key,
    (s) => s,
  )
  return `  ${icon} ${BOLD}${secret.key}${RESET} ${DIM}(${svc})${RESET} ${secret.status} ${days} ${rotation}`.trimEnd()
}

export const formatAudit = (audit: AuditResult): string => {
  const color = statusColor(audit.status)
  const icon = statusIcon(audit.status)
  const header = `${icon} ${BOLD}${color}${audit.status.toUpperCase()}${RESET} — ${audit.total} secrets`
  const summary = [
    `  ${GREEN}${audit.healthy}${RESET} healthy`,
    audit.expiring_soon > 0 ? `  ${YELLOW}${audit.expiring_soon}${RESET} expiring soon` : null,
    audit.expired > 0 ? `  ${RED}${audit.expired}${RESET} expired` : null,
    audit.stale > 0 ? `  ${YELLOW}${audit.stale}${RESET} stale` : null,
    audit.missing > 0 ? `  ${RED}${audit.missing}${RESET} missing` : null,
    audit.missing_metadata > 0 ? `  ${YELLOW}${audit.missing_metadata}${RESET} missing metadata` : null,
    audit.orphaned > 0 ? `  ${YELLOW}${audit.orphaned}${RESET} orphaned` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const details = audit.secrets
    .filter((s) => s.status !== "healthy")
    .map(formatSecretRow)
    .toArray()
    .join("\n")

  return [header, summary, details].filter((s) => s.length > 0).join("\n\n")
}

export const formatAuditJson = (audit: AuditResult): string =>
  JSON.stringify(
    {
      status: audit.status,
      total: audit.total,
      healthy: audit.healthy,
      expiring_soon: audit.expiring_soon,
      expired: audit.expired,
      stale: audit.stale,
      missing: audit.missing,
      missing_metadata: audit.missing_metadata,
      orphaned: audit.orphaned,
      secrets: audit.secrets
        .map((s) => ({
          key: s.key,
          service: s.service.fold(
            () => null,
            (sv) => sv,
          ),
          status: s.status,
          days_remaining: s.days_remaining.fold(
            () => null,
            (d) => d,
          ),
          rotation_url: s.rotation_url.fold(
            () => null,
            (u) => u,
          ),
          purpose: s.purpose.fold(
            () => null,
            (p) => p,
          ),
          issues: s.issues.toArray(),
        }))
        .toArray(),
    },
    null,
    2,
  )

export const formatFleetJson = (fleet: FleetHealth): string =>
  JSON.stringify(
    {
      status: fleet.status,
      total_agents: fleet.total_agents,
      total_secrets: fleet.total_secrets,
      expired: fleet.expired,
      expiring_soon: fleet.expiring_soon,
      agents: fleet.agents
        .map((a) => ({
          path: a.path,
          name: a.agent?.name ?? null,
          consumer: a.agent?.consumer ?? null,
          description: a.agent?.description ?? null,
          status: a.audit.status,
          secrets: a.audit.total,
        }))
        .toArray(),
    },
    null,
    2,
  )

export const formatError = (error: { _tag: string; message?: string; path?: string; errors?: unknown }): string => {
  const tag = error._tag
  switch (tag) {
    case "FileNotFound":
      return `${RED}Error:${RESET} Config file not found: ${error.path}`
    case "ParseError":
      return `${RED}Error:${RESET} Failed to parse TOML: ${error.message}`
    case "ValidationError":
      return `${RED}Error:${RESET} Config validation failed:\n${String(error.errors)}`
    case "ReadError":
      return `${RED}Error:${RESET} Could not read file: ${error.message}`
    case "AgeNotFound":
      return `${RED}Error:${RESET} age CLI not found: ${error.message}`
    case "DecryptFailed":
      return `${RED}Error:${RESET} Decrypt failed: ${error.message}`
    case "IdentityNotFound":
      return `${RED}Error:${RESET} Identity file not found: ${error.path}`
    case "AuditFailed":
      return `${RED}Error:${RESET} Audit failed: ${error.message}`
    default:
      return `${RED}Error:${RESET} ${error.message ?? tag}`
  }
}

export const exitCodeForAudit = (audit: AuditResult): number => {
  switch (audit.status) {
    case "healthy":
      return 0
    case "degraded":
      return 1
    case "critical":
      return 2
  }
}

export { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW }
