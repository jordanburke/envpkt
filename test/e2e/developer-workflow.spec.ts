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
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-dev-wf-"))
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

describe("Developer Workflow: env scan → catalog → env export", () => {
  describe("env scan --write discovers secrets and writes valid TOML", () => {
    it("discovers injected env vars and writes envpkt.toml", () => {
      const { stdout, status } = run(["env", "scan", "--write"], {
        cwd: tmpDir,
        env: {
          STRIPE_SECRET_KEY: "sk_test_abc123",
          OPENAI_API_KEY: "sk-proj-xyz789",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      })
      expect(status).toBe(0)
      expect(stdout).toContain("Created")

      const toml = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
      expect(toml).toContain("version = 1")
      expect(toml).toContain("[secret.STRIPE_SECRET_KEY]")
      expect(toml).toContain("[secret.OPENAI_API_KEY]")
      expect(toml).toContain('service = "stripe"')
      expect(toml).toContain('service = "openai"')
    })

    it("appends new entries to existing envpkt.toml", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n\n[secret.EXISTING_KEY]\nservice = "test"\n`)

      const { stdout, status } = run(["env", "scan", "--write"], {
        cwd: tmpDir,
        env: {
          EXISTING_KEY: "already-tracked",
          GITHUB_TOKEN: "ghp_newtoken123",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      })
      expect(status).toBe(0)

      const toml = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
      expect(toml).toContain("[secret.EXISTING_KEY]")
      expect(toml).toContain("[secret.GITHUB_TOKEN]")
    })
  })

  describe("catalog resolution via ENVPKT_CONFIG", () => {
    it("resolves catalog from a separate directory", () => {
      const catalogDir = join(tmpDir, "shared")
      const agentDir = join(tmpDir, "agents", "my-agent")
      mkdirSync(catalogDir, { recursive: true })
      mkdirSync(agentDir, { recursive: true })

      writeFileSync(
        join(catalogDir, "catalog.toml"),
        `version = 1\n\n[secret.DATABASE_URL]\nservice = "postgres"\npurpose = "Primary database"\n`,
      )

      writeFileSync(
        join(agentDir, "envpkt.toml"),
        `version = 1\ncatalog = "../../shared/catalog.toml"\n\n[identity]\nname = "my-agent"\nsecrets = ["DATABASE_URL"]\n`,
      )

      const { stdout, status } = run(["audit", "-c", join(agentDir, "envpkt.toml")])
      expect(status).toBe(0)
      // Audit shows HEALTHY summary; catalog resolution succeeded if status is 0
      expect(stdout).toContain("HEALTHY")
      expect(stdout).toContain("1 secrets")
    })

    it("ENVPKT_CONFIG overrides CWD discovery", () => {
      const configDir = join(tmpDir, "config-elsewhere")
      mkdirSync(configDir, { recursive: true })

      writeFileSync(join(configDir, "envpkt.toml"), `version = 1\n[secret.REMOTE_KEY]\nservice = "remote"\n`)

      // Run from a different CWD that has no config
      const otherDir = join(tmpDir, "other-dir")
      mkdirSync(otherDir, { recursive: true })

      const { stdout, status } = run(["audit"], {
        cwd: otherDir,
        env: { ENVPKT_CONFIG: join(configDir, "envpkt.toml") },
      })
      expect(status).toBe(0)
      // Found config via ENVPKT_CONFIG, not CWD
      expect(stdout).toContain("HEALTHY")
      expect(stdout).toContain("1 secrets")
    })
  })

  describe("env export outputs export statements", () => {
    it("outputs export KEY='VALUE' lines for env defaults", () => {
      writeFileSync(
        join(tmpDir, "envpkt.toml"),
        `version = 1\n\n[env.ENVPKT_TEST_EXPORT_VAR]\nvalue = "test-value-123"\npurpose = "Test env default"\n`,
      )

      const { stdout, status } = run(["env", "export", "-c", join(tmpDir, "envpkt.toml")])
      expect(status).toBe(0)
      expect(stdout).toContain("export ENVPKT_TEST_EXPORT_VAR='test-value-123'")
    })
  })

  describe("env check detects drift", () => {
    it("reports present secret as tracked in JSON", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.MY_VAR]\nservice = "test"\n`)

      const { stdout, status } = run(["env", "check", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"], {
        env: { MY_VAR: "some-value" },
      })
      expect(status).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ envVar: "MY_VAR", status: "tracked" })]),
      )
      expect(data.tracked_and_present).toBeGreaterThanOrEqual(1)
    })

    it("detects missing env vars as drift", () => {
      writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n[secret.MISSING_VAR]\nservice = "test"\n`)

      const { stdout } = run(["env", "check", "-c", join(tmpDir, "envpkt.toml"), "--format", "json"], {
        env: { PATH: process.env.PATH ?? "" },
      })
      const data = JSON.parse(stdout)
      expect(data.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ envVar: "MISSING_VAR", status: "missing_from_env" })]),
      )
      expect(data.missing_from_env).toBeGreaterThanOrEqual(1)
    })
  })

  describe("shell-hook outputs shell function", () => {
    it("zsh hook outputs chpwd function", () => {
      const { stdout, status } = run(["shell-hook", "zsh"])
      expect(status).toBe(0)
      expect(stdout).toContain("_envpkt_chpwd")
      expect(stdout).toContain("envpkt audit")
    })

    it("bash hook outputs PROMPT_COMMAND setup", () => {
      const { stdout, status } = run(["shell-hook", "bash"])
      expect(status).toBe(0)
      expect(stdout).toContain("PROMPT_COMMAND")
      expect(stdout).toContain("envpkt audit")
    })
  })
})
