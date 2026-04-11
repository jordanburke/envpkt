import { resolve } from "node:path"

import { Option } from "functype"

import { scanFleet } from "../../core/fleet.js"
import type { HealthStatus } from "../../core/types.js"
import { BOLD, DIM, formatFleetJson, GREEN, RED, RESET, YELLOW } from "../output.js"

type FleetOptions = {
  readonly dir?: string
  readonly depth?: number
  readonly format?: string
  readonly status?: string
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

export const runFleet = (options: FleetOptions): void => {
  const rootDir = resolve(options.dir ?? ".")
  const fleet = scanFleet(rootDir, { maxDepth: options.depth })

  if (options.format === "json") {
    console.log(formatFleetJson(fleet))
    process.exit(fleet.status === "critical" ? 2 : 0)
    return
  }

  const statusFilter: Option<HealthStatus> = Option(options.status as HealthStatus)
  const agents = statusFilter.fold(
    () => fleet.agents,
    (s) => fleet.agents.filter((a) => a.audit.status === s),
  )

  console.log(
    `${statusIcon(fleet.status)} ${BOLD}Fleet: ${fleet.status.toUpperCase()}${RESET} — ${fleet.total_agents} agents, ${fleet.total_secrets} secrets`,
  )

  if (fleet.expired > 0) console.log(`  ${RED}${fleet.expired}${RESET} expired`)
  if (fleet.expiring_soon > 0) console.log(`  ${YELLOW}${fleet.expiring_soon}${RESET} expiring soon`)

  console.log("")

  agents.forEach((agent) => {
    const name = agent.identity?.name ? BOLD + agent.identity.name + RESET : DIM + agent.path + RESET
    const icon = statusIcon(agent.audit.status)
    console.log(`  ${icon} ${name} ${DIM}(${agent.audit.total} secrets)${RESET}`)
  })

  process.exit(fleet.status === "critical" ? 2 : 0)
}
