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
    expect(stdout).toContain("secret")
    expect(stdout).toContain("env")
  })

  describe("subcommand help surfaces options", () => {
    it("audit --help shows -c, --config", () => {
      const { stdout, status } = run(["audit", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--strict")
      expect(stdout).toContain("--format <format>")
    })

    it("inspect --help shows -c, --config", () => {
      const { stdout, status } = run(["inspect", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--resolved")
      expect(stdout).toContain("--secrets")
    })

    it("exec --help shows -c, --config", () => {
      const { stdout, status } = run(["exec", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--skip-audit")
      expect(stdout).toContain("--strict")
    })

    it("resolve --help shows -c, --config", () => {
      const { stdout, status } = run(["resolve", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("-o, --output <path>")
      expect(stdout).toContain("--dry-run")
    })

    it("seal --help shows -c, --config and --reseal", () => {
      const { stdout, status } = run(["seal", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--reseal")
    })

    it("mcp --help shows -c, --config", () => {
      const { stdout, status } = run(["mcp", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
    })

    it("env scan --help shows -c, --config, --write, --dry-run", () => {
      const { stdout, status } = run(["env", "scan", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--write")
      expect(stdout).toContain("--dry-run")
    })

    it("env check --help shows -c, --config", () => {
      const { stdout, status } = run(["env", "check", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--strict")
    })

    it("env export --help shows -c, --config", () => {
      const { stdout, status } = run(["env", "export", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--profile <profile>")
    })

    it("fleet --help shows -d, --dir", () => {
      const { stdout, status } = run(["fleet", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-d, --dir <path>")
      expect(stdout).toContain("--depth <n>")
    })

    it("secret --help shows subcommands", () => {
      const { stdout, status } = run(["secret", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("add")
      expect(stdout).toContain("edit")
      expect(stdout).toContain("rm")
      expect(stdout).toContain("rename")
    })

    it("secret add --help shows options", () => {
      const { stdout, status } = run(["secret", "add", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--service <service>")
      expect(stdout).toContain("--dry-run")
    })

    it("env add --help shows options", () => {
      const { stdout, status } = run(["env", "add", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("-c, --config <path>")
      expect(stdout).toContain("--purpose <purpose>")
      expect(stdout).toContain("--dry-run")
    })

    it("env edit --help shows options", () => {
      const { stdout, status } = run(["env", "edit", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("--value <value>")
      expect(stdout).toContain("--purpose <purpose>")
    })

    it("env rm --help shows options", () => {
      const { stdout, status } = run(["env", "rm", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("--dry-run")
    })

    it("env rename --help shows options", () => {
      const { stdout, status } = run(["env", "rename", "--help"])
      expect(status).toBe(0)
      expect(stdout).toContain("--dry-run")
    })
  })

  it("shows version with --version", () => {
    const { stdout, status } = run(["--version"])
    expect(status).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
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

    it("creates envpkt.toml with identity section", () => {
      const { status } = run(["init", "--identity", "--name", "my-agent"], { cwd: tmpDir })
      expect(status).toBe(0)

      const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
      expect(content).toContain("[identity]")
      expect(content).toContain('name = "my-agent"')
    })
  })

  describe("audit", () => {
    it("outputs healthy for a valid config", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.KEY]\nservice = "svc"\n`)
      const { stdout, status } = run(["audit", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBe(0)
      expect(stdout).toContain("HEALTHY")
    })

    it("exits non-zero for expired secrets", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[secret.OLD]\nservice = "old"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { stdout, status } = run(["audit", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBeGreaterThan(0)
      expect(stdout).toContain("CRITICAL")
    })

    it("outputs JSON with --format json", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)
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
        `version = 1\n[identity]\nname = "bot"\n[secret.API_KEY]\nservice = "stripe"\npurpose = "Payments"\n`,
      )
      const { stdout, status } = run(["inspect", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBe(0)
      expect(stdout).toContain("bot")
      expect(stdout).toContain("API_KEY")
      expect(stdout).toContain("stripe")
    })

    it("outputs JSON with --format json", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.X]\nservice = "y"\n`)
      const { stdout, status } = run(["inspect", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.version).toBe(1)
      expect(data.secret.X.service).toBe("y")
    })
  })

  describe("fleet", () => {
    it("scans directory tree for envpkt configs", () => {
      const agentDir = join(tmpDir, "agent-a")
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)

      const { stdout, status } = run(["fleet", "-d", tmpDir])
      expect(status).toBe(0)
      expect(stdout).toContain("1 agent")
    })

    it("outputs JSON with --format json", () => {
      const agentDir = join(tmpDir, "agent-b")
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)

      const { stdout, status } = run(["fleet", "-d", tmpDir, "--format", "json"])
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.total_agents).toBe(1)
    })
  })

  describe("exec", () => {
    it("runs a command after pre-flight audit", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "echo", "hello"])
      expect(status).toBe(0)
      expect(stdout).toContain("hello")
    })

    it("runs with --skip-audit", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--skip-audit", "echo", "world"])
      expect(status).toBe(0)
      expect(stdout).toContain("world")
    })

    it("runs with --no-check (alias for --skip-audit)", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.K]\nservice = "s"\n`)
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--no-check", "echo", "aliased"])
      expect(status).toBe(0)
      expect(stdout).toContain("aliased")
    })

    it("exits non-zero with --strict on critical audit", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--strict", "echo", "nope"])
      expect(status).toBeGreaterThan(0)
    })

    it("runs with --warn-only on critical audit", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
      )
      const { stdout, status } = run(["exec", "-c", join(tmpDir, "envpkt.toml"), "--warn-only", "echo", "warn-passed"])
      expect(status).toBe(0)
      expect(stdout).toContain("warn-passed")
    })
  })
})
