import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-diff-"))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const p = join(tmpDir, name)
  writeFileSync(p, content)
  return p
}

const run = (args: string[]): { stdout: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, "diff", ...args], { encoding: "utf-8" })
    return { stdout, status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? "", status: e.status ?? 1 }
  }
}

const DEV = `version = 1\n\n[secret.API_KEY]\nservice = "stripe"\nexpires = "2026-01-01"\n\n[secret.OLD]\nservice = "x"\n`
const PROD = `version = 1\n\n[secret.API_KEY]\nservice = "stripe"\nexpires = "2027-01-01"\n\n[secret.NEW]\nservice = "y"\n`

describe("envpkt diff", () => {
  it("reports added/removed/changed and exits 0 by default", () => {
    const a = write("dev.toml", DEV)
    const b = write("prod.toml", PROD)
    const { stdout, status } = run([a, b])
    expect(status).toBe(0)
    expect(stdout).toContain("- OLD")
    expect(stdout).toContain("+ NEW")
    expect(stdout).toContain("~ API_KEY")
    expect(stdout).toContain("expires:")
  })

  it("reports no differences for identical configs", () => {
    const a = write("a.toml", DEV)
    const { stdout, status } = run([a, a])
    expect(status).toBe(0)
    expect(stdout).toContain("no differences")
  })

  it("--exit-code exits 1 on difference, 0 when identical", () => {
    const a = write("dev.toml", DEV)
    const b = write("prod.toml", PROD)
    expect(run([a, b, "--exit-code"]).status).toBe(1)
    expect(run([a, a, "--exit-code"]).status).toBe(0)
  })

  it("--format json emits a structured diff", () => {
    const a = write("dev.toml", DEV)
    const b = write("prod.toml", PROD)
    const parsed = JSON.parse(run([a, b, "--format", "json"]).stdout)
    expect(parsed.secret.onlyA).toEqual(["OLD"])
    expect(parsed.secret.onlyB).toEqual(["NEW"])
    expect(parsed.identical).toBe(false)
  })

  it("exits 2 when a config file can't be loaded", () => {
    const a = write("dev.toml", DEV)
    expect(run([a, join(tmpDir, "nope.toml")]).status).toBe(2)
  })
})
