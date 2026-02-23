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
    expect(fleet.critical_count).toBe(1)
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

  it("reads agent name and role from config", () => {
    writeEnvpkt(
      join(tmpDir, "named-agent"),
      `version = 1\n[agent]\nname = "my-agent"\nrole = "processor"\n[meta.K]\nservice = "s"\n`,
    )

    const fleet = scanFleet(tmpDir)
    const agent = fleet.agents.get(0)
    agent.fold(
      () => expect.unreachable("Expected agent"),
      (a) => {
        a.name.fold(
          () => expect.unreachable("Expected name"),
          (n) => expect(n).toBe("my-agent"),
        )
        a.role.fold(
          () => expect.unreachable("Expected role"),
          (r) => expect(r).toBe("processor"),
        )
      },
    )
  })
})
