import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-env-test-"))
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
      encoding: "utf-8",
      timeout: 15000,
    })
    return { stdout, status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? "", status: e.status ?? 1 }
  }
}

describe("envpkt env scan", () => {
  it("discovers credentials from environment", () => {
    const result = run(["env", "scan"], {
      env: { OPENAI_API_KEY: "sk-test123", STRIPE_SECRET_KEY: "sk_live_abc" },
    })

    expect(result.stdout).toContain("OPENAI_API_KEY")
    expect(result.stdout).toContain("openai")
  })

  it("outputs JSON with --format json", () => {
    const result = run(["env", "scan", "--format", "json"], {
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    const json = JSON.parse(result.stdout)
    expect(json.discovered).toBeGreaterThanOrEqual(1)
    expect(json.matches).toBeInstanceOf(Array)
    const openai = json.matches.find((m: { envVar: string }) => m.envVar === "OPENAI_API_KEY")
    expect(openai).toBeDefined()
    expect(openai.service).toBe("openai")
  })

  it("generates TOML preview with --dry-run", () => {
    const result = run(["env", "scan", "--dry-run"], {
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    expect(result.stdout).toContain("[meta.OPENAI_API_KEY]")
    expect(result.stdout).toContain('service = "openai"')
    expect(result.stdout).toContain("Preview")
  })

  it("writes new envpkt.toml with --write", () => {
    run(["env", "scan", "--write"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("version = 1")
    expect(content).toContain("[meta.OPENAI_API_KEY]")
    expect(content).toContain('service = "openai"')
  })

  it("appends to existing envpkt.toml with --write", () => {
    const existingToml = `version = 1\n\n[meta.EXISTING_KEY]\nservice = "existing"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), existingToml)

    run(["env", "scan", "--write"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("[meta.EXISTING_KEY]")
    expect(content).toContain("[meta.OPENAI_API_KEY]")
  })

  it("does not duplicate already-tracked entries on --write", () => {
    const existingToml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), existingToml)

    run(["env", "scan", "--write"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    // Count occurrences of [meta.OPENAI_API_KEY] — should be exactly 1 (not duplicated)
    const matches = content.match(/\[meta\.OPENAI_API_KEY\]/g)
    expect(matches).toHaveLength(1)
  })
})

describe("envpkt env check", () => {
  it("reports tracked keys present in env", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["env", "check"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    // May or may not be fully clean depending on inherited env vars
    expect(result.stdout).toContain("tracked and present")
    expect(result.status).toBe(0)
  })

  it("detects missing_from_env", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\n[meta.STRIPE_SECRET_KEY]\nservice = "stripe"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["env", "check"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    expect(result.stdout).toContain("DRIFT")
    expect(result.stdout).toContain("missing from env")
  })

  it("outputs JSON with --format json", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["env", "check", "--format", "json"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    const json = JSON.parse(result.stdout)
    expect(json.tracked_and_present).toBe(1)
    expect(json.missing_from_env).toBe(0)
  })

  it("exits non-zero with --strict on drift", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\n[meta.MISSING_KEY]\nservice = "x"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["env", "check", "--strict"], {
      cwd: tmpDir,
      env: { OPENAI_API_KEY: "sk-test123" },
    })

    expect(result.status).not.toBe(0)
  })
})

describe("envpkt shell-hook", () => {
  it("outputs zsh hook", () => {
    const result = run(["shell-hook", "zsh"])
    expect(result.stdout).toContain("chpwd")
    expect(result.stdout).toContain("envpkt audit --format minimal")
    expect(result.status).toBe(0)
  })

  it("outputs bash hook", () => {
    const result = run(["shell-hook", "bash"])
    expect(result.stdout).toContain("PROMPT_COMMAND")
    expect(result.stdout).toContain("envpkt audit --format minimal")
    expect(result.status).toBe(0)
  })

  it("fails for unsupported shell", () => {
    const result = run(["shell-hook", "fish"])
    expect(result.status).not.toBe(0)
  })
})

describe("envpkt audit --format minimal", () => {
  it("outputs single-line status for healthy audit", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\ncreated = "2026-01-01"\nexpires = "2027-01-01"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["audit", "--format", "minimal"], { cwd: tmpDir })
    expect(result.stdout).toContain("healthy")
  })

  it("outputs warnings for degraded audit", () => {
    const toml = `version = 1\n\n[meta.OPENAI_API_KEY]\nservice = "openai"\ncreated = "2024-01-01"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run(["audit", "--format", "minimal"], { cwd: tmpDir })
    expect(result.stdout).toContain("stale")
  })
})
