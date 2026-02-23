import { resolve } from "node:path"

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

  const statusFilter = options.status as HealthStatus | undefined
  const agents = statusFilter ? fleet.agents.filter((a) => a.audit.status === statusFilter) : fleet.agents

  console.log(
    `${statusIcon(fleet.status)} ${BOLD}Fleet: ${fleet.status.toUpperCase()}${RESET} — ${fleet.total_agents} agents, ${fleet.total_secrets} secrets`,
  )

  if (fleet.critical_count > 0) console.log(`  ${RED}${fleet.critical_count}${RESET} critical`)
  if (fleet.degraded_count > 0) console.log(`  ${YELLOW}${fleet.degraded_count}${RESET} degraded`)

  console.log("")

  for (const agent of agents) {
    const name = agent.name.fold(
      () => DIM + agent.path + RESET,
      (n) => BOLD + n + RESET,
    )
    const icon = statusIcon(agent.audit.status)
    console.log(`  ${icon} ${name} ${DIM}(${agent.audit.total} secrets)${RESET}`)
  }

  process.exit(fleet.status === "critical" ? 2 : 0)
}
