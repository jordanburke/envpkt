import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { scanFleet } from "../../src/core/fleet.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-fleet-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const writeEnvpkt = (dir: string, content: string): void => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "envpkt.toml"), content)
}

describe("scanFleet", () => {
  it("finds envpkt.toml files in subdirectories", () => {
    writeEnvpkt(join(tmpDir, "agent-a"), `version = 1\n[meta.KEY_A]\nservice = "svc-a"\n`)
    writeEnvpkt(join(tmpDir, "agent-b"), `version = 1\n[meta.KEY_B]\nservice = "svc-b"\n`)

    const fleet = scanFleet(tmpDir)
    expect(fleet.total_agents).toBe(2)
    expect(fleet.total_secrets).toBe(2)
    expect(fleet.status).toBe("healthy")
  })

  it("detects critical fleet status when agent has expired secrets", () => {
    writeEnvpkt(
      join(tmpDir, "bad-agent"),
      `version = 1\n[meta.OLD_KEY]\nservice = "legacy"\ncreated = "2020-01-01"\nexpires = "2022-01-01"\n`,
    )

    const fleet = scanFleet(tmpDir)
    expect(fleet.status).toBe("critical")
    expect(fleet.expired).toBeGreaterThan(0)
  })

  it("skips node_modules and .git directories", () => {
    writeEnvpkt(join(tmpDir, "node_modules", "pkg"), `version = 1\n[meta.X]\nservice = "x"\n`)
    writeEnvpkt(join(tmpDir, ".git", "hooks"), `version = 1\n[meta.Y]\nservice = "y"\n`)
    writeEnvpkt(join(tmpDir, "real-agent"), `version = 1\n[meta.Z]\nservice = "z"\n`)

    const fleet = scanFleet(tmpDir)
    expect(fleet.total_agents).toBe(1)
  })

  it("respects maxDepth option", () => {
    writeEnvpkt(join(tmpDir, "a"), `version = 1\n[meta.X]\nservice = "x"\n`)
    writeEnvpkt(join(tmpDir, "a", "b", "c", "d"), `version = 1\n[meta.Y]\nservice = "y"\n`)

    const shallow = scanFleet(tmpDir, { maxDepth: 1 })
    expect(shallow.total_agents).toBe(1)

    const deep = scanFleet(tmpDir, { maxDepth: 5 })
    expect(deep.total_agents).toBe(2)
  })

  it("returns empty fleet for directory with no configs", () => {
    const fleet = scanFleet(tmpDir)
    expect(fleet.total_agents).toBe(0)
    expect(fleet.total_secrets).toBe(0)
    expect(fleet.status).toBe("healthy")
  })

  it("finds envpkt.toml in root directory itself", () => {
    writeEnvpkt(tmpDir, `version = 1\n[meta.ROOT]\nservice = "root-svc"\n`)

    const fleet = scanFleet(tmpDir)
    expect(fleet.total_agents).toBe(1)
  })

  it("reads agent identity from config", () => {
    writeEnvpkt(
      join(tmpDir, "named-agent"),
      `version = 1\n[agent]\nname = "my-agent"\nconsumer = "agent"\ndescription = "Test agent"\n[meta.K]\nservice = "s"\n`,
    )

    const fleet = scanFleet(tmpDir)
    const agent = fleet.agents.get(0)
    agent.fold(
      () => expect.unreachable("Expected agent"),
      (a) => {
        expect(a.agent?.name).toBe("my-agent")
        expect(a.agent?.consumer).toBe("agent")
        expect(a.agent?.description).toBe("Test agent")
      },
    )
  })

  it("tracks expired and expiring_soon counts", () => {
    writeEnvpkt(
      join(tmpDir, "exp-agent"),
      `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2022-01-01"\n`,
    )
    writeEnvpkt(join(tmpDir, "ok-agent"), `version = 1\n[meta.OK]\nservice = "y"\n`)

    const fleet = scanFleet(tmpDir)
    expect(fleet.expired).toBeGreaterThan(0)
  })

  it("computes min_expiry_days for agents", () => {
    writeEnvpkt(
      join(tmpDir, "expiry-agent"),
      `version = 1\n[meta.K1]\nservice = "a"\nexpires = "2030-01-01"\n[meta.K2]\nservice = "b"\nexpires = "2028-06-01"\n`,
    )

    const fleet = scanFleet(tmpDir)
    const agent = fleet.agents.get(0)
    agent.fold(
      () => expect.unreachable("Expected agent"),
      (a) => {
        expect(a.min_expiry_days).toBeDefined()
        expect(typeof a.min_expiry_days).toBe("number")
      },
    )
  })
})
