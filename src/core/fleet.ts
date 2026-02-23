import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { Cond, List, Option, Try } from "functype"

import { computeAudit } from "./audit.js"
import { loadConfig } from "./config.js"
import type { FleetAgent, FleetHealth, HealthStatus } from "./types.js"

const CONFIG_FILENAME = "envpkt.toml"
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "lib", ".claude", "__pycache__"])

function* findEnvpktFiles(dir: string, maxDepth: number, currentDepth = 0): Generator<string> {
  if (currentDepth > maxDepth) return

  const configPath = join(dir, CONFIG_FILENAME)
  const exists = Try(() => statSync(configPath).isFile()).fold(
    () => false,
    (v) => v,
  )
  if (exists) {
    yield configPath
  }

  if (currentDepth >= maxDepth) return

  let entries: import("node:fs").Dirent[] = []
  Try(() => readdirSync(dir, { withFileTypes: true })).fold(
    () => {},
    (e) => {
      entries = e
    },
  )

  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
      yield* findEnvpktFiles(join(dir, entry.name), maxDepth, currentDepth + 1)
    }
  }
}

export const scanFleet = (rootDir: string, options?: { maxDepth?: number }): FleetHealth => {
  const maxDepth = options?.maxDepth ?? 3

  const agents: FleetAgent[] = []

  for (const configPath of findEnvpktFiles(rootDir, maxDepth)) {
    const result = loadConfig(configPath)
    result.fold(
      () => {
        // Skip unreadable configs
      },
      (config) => {
        const audit = computeAudit(config)
        agents.push({
          path: configPath,
          name: Option(config.agent?.name),
          role: Option(config.agent?.role),
          audit,
        })
      },
    )
  }

  const agentList = List(agents)
  const total_agents = agentList.size
  const total_secrets = agentList.toArray().reduce((acc, a) => acc + a.audit.total, 0)
  const critical_count = agentList.count((a) => a.audit.status === "critical")
  const degraded_count = agentList.count((a) => a.audit.status === "degraded")

  const status: HealthStatus = Cond.of<HealthStatus>()
    .when(critical_count > 0, "critical")
    .elseWhen(degraded_count > 0, "degraded")
    .else("healthy")

  return {
    status,
    agents: agentList,
    total_agents,
    total_secrets,
    critical_count,
    degraded_count,
  }
}
