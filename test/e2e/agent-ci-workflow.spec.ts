import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-ci-wf-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const run = (
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
): { stdout: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      cwd: opts?.cwd ?? tmpDir,
      env: { ...process.env, ...opts?.env },
      stdio: "pipe",
      encoding: "utf-8",
    })
    return { stdout, status: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 }
  }
}

const healthyConfig = `version = 1
catalog = "../../shared/catalog.toml"

[identity]
name = "deploy-bot"
consumer = "ci"
secrets = ["API_KEY", "DB_URL"]
`

const catalogToml = `version = 1

[lifecycle]
stale_warning_days = 90
require_service = true

[secret.API_KEY]
service = "internal"
purpose = "API authentication"
created = "2026-01-01"
expires = "2027-01-01"

[secret.DB_URL]
service = "postgres"
purpose = "Database connection"
created = "2026-01-01"
expires = "2027-01-01"
`

const expiredCatalog = `version = 1

[secret.OLD_KEY]
service = "legacy"
purpose = "Deprecated service"
created = "2020-01-01"
expires = "2021-01-01"
`

const setupCatalogAgent = (
  dir: string,
  catalog: string = catalogToml,
  agentConfig: string = healthyConfig,
): { agentDir: string; catalogDir: string } => {
  const catalogDir = join(dir, "shared")
  const agentDir = join(dir, "agents", "deploy-bot")
  mkdirSync(catalogDir, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(catalogDir, "catalog.toml"), catalog)
  writeFileSync(join(agentDir, "envpkt.toml"), agentConfig)
  return { agentDir, catalogDir }
}

describe("Agent & CI/CD Workflow: audit → seal → exec → fleet", () => {
  describe("audit --strict gate", () => {
    it("exits 0 for healthy catalog-backed config", () => {
      const { agentDir } = setupCatalogAgent(tmpDir)
      const configPath = join(agentDir, "envpkt.toml")

      const { status } = run(["audit", "--strict", "-c", configPath])
      expect(status).toBe(0)
    })

    it("exits non-zero for expired secrets in catalog", () => {
      const { agentDir } = setupCatalogAgent(
        tmpDir,
        expiredCatalog,
        `version = 1\ncatalog = "../../shared/catalog.toml"\n\n[identity]\nname = "stale-bot"\nsecrets = ["OLD_KEY"]\n`,
      )
      const configPath = join(agentDir, "envpkt.toml")

      const { status } = run(["audit", "--strict", "-c", configPath])
      expect(status).toBeGreaterThan(0)
    })

    it("outputs structured JSON with --format json", () => {
      const { agentDir } = setupCatalogAgent(tmpDir)
      const configPath = join(agentDir, "envpkt.toml")

      const { stdout, status } = run(["audit", "--strict", "-c", configPath, "--format", "json"])
      expect(status).toBe(0)
      // Catalog line may precede JSON; extract the JSON object
      const jsonLine = stdout.substring(stdout.indexOf("{"))
      const data = JSON.parse(jsonLine)
      expect(data.status).toBe("healthy")
      expect(data.total).toBe(2)
    })
  })

  describe("exec with catalog-backed audit", () => {
    it("runs command after successful audit", () => {
      const { agentDir } = setupCatalogAgent(tmpDir)
      const configPath = join(agentDir, "envpkt.toml")

      const { stdout, status } = run(["exec", "-c", configPath, "echo", "deployed"])
      expect(status).toBe(0)
      expect(stdout).toContain("deployed")
    })

    it("refuses to run with --strict on expired secrets", () => {
      const { agentDir } = setupCatalogAgent(
        tmpDir,
        expiredCatalog,
        `version = 1\ncatalog = "../../shared/catalog.toml"\n\n[identity]\nname = "stale-bot"\nsecrets = ["OLD_KEY"]\n`,
      )
      const configPath = join(agentDir, "envpkt.toml")

      const { stdout, status } = run(["exec", "-c", configPath, "--strict", "echo", "should-not-run"])
      expect(status).toBeGreaterThan(0)
      expect(stdout).not.toContain("should-not-run")
    })
  })

  describe("fleet scanning", () => {
    it("scans multiple agent directories and reports aggregate health", () => {
      const agentA = join(tmpDir, "agents", "agent-a")
      const agentB = join(tmpDir, "agents", "agent-b")
      const agentC = join(tmpDir, "agents", "agent-c")
      mkdirSync(agentA, { recursive: true })
      mkdirSync(agentB, { recursive: true })
      mkdirSync(agentC, { recursive: true })

      writeFileSync(join(agentA, "envpkt.toml"), `version = 1\n[secret.K1]\nservice = "a"\n`)
      writeFileSync(join(agentB, "envpkt.toml"), `version = 1\n[secret.K2]\nservice = "b"\n`)
      writeFileSync(join(agentC, "envpkt.toml"), `version = 1\n[secret.K3]\nservice = "c"\n`)

      const { stdout, status } = run(["fleet", "-d", tmpDir, "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.total_agents).toBe(3)
      expect(data.total_secrets).toBe(3)
    })

    it("filters by --status critical", () => {
      const healthyDir = join(tmpDir, "agents", "healthy")
      const criticalDir = join(tmpDir, "agents", "critical")
      mkdirSync(healthyDir, { recursive: true })
      mkdirSync(criticalDir, { recursive: true })

      writeFileSync(join(healthyDir, "envpkt.toml"), `version = 1\n[secret.GOOD]\nservice = "ok"\n`)
      writeFileSync(
        join(criticalDir, "envpkt.toml"),
        `version = 1\n[secret.BAD]\nservice = "old"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )

      const { stdout, status } = run(["fleet", "-d", tmpDir, "--status", "critical"])
      // Fleet exits 2 when any agent is critical
      expect(status).toBe(2)
      expect(stdout).toContain("critical")
    })
  })

  describe("env check --strict drift detection", () => {
    it("exits non-zero on drift when secret missing from env", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.REQUIRED_KEY]\nservice = "test"\n`)

      const { status } = run(["env", "check", "-c", join(tmpDir, "envpkt.toml"), "--strict"], {
        env: { PATH: process.env.PATH ?? "" },
      })
      expect(status).toBeGreaterThan(0)
    })

    it("exits 0 when env matches config (without --strict)", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.PRESENT_KEY]\nservice = "test"\n`)

      const { stdout, status } = run(["env", "check", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"], {
        env: { PRESENT_KEY: "value" },
      })
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.tracked_and_present).toBeGreaterThanOrEqual(1)
      expect(data.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ envVar: "PRESENT_KEY", status: "tracked" })]),
      )
    })
  })
})
