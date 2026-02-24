import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-e2e-"))
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

describe("envpkt CLI e2e", () => {
  it("shows help with --help", () => {
    const { stdout, status } = run(["--help"])
    expect(status).toBe(0)
    expect(stdout).toContain("envpkt")
    expect(stdout).toContain("init")
    expect(stdout).toContain("audit")
    expect(stdout).toContain("fleet")
    expect(stdout).toContain("inspect")
    expect(stdout).toContain("exec")
    expect(stdout).toContain("resolve")
    expect(stdout).toContain("mcp")
  })

  it("shows version with --version", () => {
    const { stdout, status } = run(["--version"])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe("0.1.0")
  })

  describe("init", () => {
    it("creates envpkt.toml in target directory", () => {
      const { status } = run(["init"], { cwd: tmpDir })
      expect(status).toBe(0)
      expect(existsSync(join(tmpDir, "envpkt.toml"))).toBe(true)

      const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
      expect(content).toContain("version = 1")
      expect(content).toContain("#:schema")
    })

    it("creates envpkt.toml with agent section", () => {
      const { status } = run(["init", "--agent", "--name", "my-agent"], { cwd: tmpDir })
      expect(status).toBe(0)

      const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
      expect(content).toContain("[agent]")
      expect(content).toContain('name = "my-agent"')
    })
  })

  describe("audit", () => {
    it("outputs healthy for a valid config", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.KEY]\nservice = "svc"\n`)
      const { stdout, status } = run(["audit", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBe(0)
      expect(stdout).toContain("HEALTHY")
    })

    it("exits non-zero for expired secrets", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[meta.OLD]\nservice = "old"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { stdout, status } = run(["audit", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBeGreaterThan(0)
      expect(stdout).toContain("CRITICAL")
    })

    it("outputs JSON with --format json", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)
      const { stdout, status } = run(["audit", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.status).toBe("healthy")
      expect(data.total).toBe(1)
    })
  })

  describe("inspect", () => {
    it("shows structured config view", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[agent]\nname = "bot"\n[meta.API_KEY]\nservice = "stripe"\npurpose = "Payments"\n`,
      )
      const { stdout, status } = run(["inspect", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBe(0)
      expect(stdout).toContain("bot")
      expect(stdout).toContain("API_KEY")
      expect(stdout).toContain("stripe")
    })

    it("outputs JSON with --format json", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.X]\nservice = "y"\n`)
      const { stdout, status } = run(["inspect", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.version).toBe(1)
      expect(data.meta.X.service).toBe("y")
    })
  })

  describe("fleet", () => {
    it("scans directory tree for envpkt configs", () => {
      const agentDir = join(tmpDir, "agent-a")
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)

      const { stdout, status } = run(["fleet", "-d", tmpDir])
      expect(status).toBe(0)
      expect(stdout).toContain("1 agent")
    })

    it("outputs JSON with --format json", () => {
      const agentDir = join(tmpDir, "agent-b")
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)

      const { stdout, status } = run(["fleet", "-d", tmpDir, "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.total_agents).toBe(1)
    })
  })

  describe("exec", () => {
    it("runs a command after pre-flight audit", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "echo", "hello"])
      expect(status).toBe(0)
      expect(stdout).toContain("hello")
    })

    it("runs with --skip-audit", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--skip-audit", "echo", "world"])
      expect(status).toBe(0)
      expect(stdout).toContain("world")
    })

    it("runs with --no-check (alias for --skip-audit)", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[meta.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--no-check", "echo", "aliased"])
      expect(status).toBe(0)
      expect(stdout).toContain("aliased")
    })

    it("exits non-zero with --strict on critical audit", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--strict", "echo", "nope"])
      expect(status).toBeGreaterThan(0)
    })

    it("runs with --warn-only on critical audit", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--warn-only", "echo", "warn-passed"])
      expect(status).toBe(0)
      expect(stdout).toContain("warn-passed")
    })
  })
})
