import { execFileSync, spawnSync } from "node:child_process"
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
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-audit-filter-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(
    configPath,
    `version = 1

[secret.SEALED_KEY]
service = "sealed"
encrypted_value = "-----BEGIN AGE ENCRYPTED FILE-----\\nabc\\n-----END AGE ENCRYPTED FILE-----"

[secret.RUNTIME_KEY]
service = "runtime"

[secret.CF_TOKEN]
service = "cloudflare"
external = true
`,
  )
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

type RunResult = { stdout: string; stderr: string }

const run = (args: string[]): RunResult => {
  const result = spawnSync(TSX, [CLI_SRC, ...args], { cwd: tmpDir, encoding: "utf-8", env: { ...process.env } })
  return { stdout: result.stdout, stderr: result.stderr }
}

const keysOf = (stdout: string): string[] =>
  (JSON.parse(stdout) as { secrets: { key: string }[] }).secrets.map((s) => s.key).sort()

describe("audit --unsealed", () => {
  it("shows only secrets without encrypted_value", () => {
    const { stdout } = run(["audit", "-c", configPath, "--format", "json", "--unsealed"])
    expect(keysOf(stdout)).toEqual(["CF_TOKEN", "RUNTIME_KEY"])
  })

  it("combines with --status external to show only external = true entries", () => {
    const { stdout } = run(["audit", "-c", configPath, "--format", "json", "--unsealed", "--status", "external"])
    expect(keysOf(stdout)).toEqual(["CF_TOKEN"])
  })
})

describe("audit --external (removed)", () => {
  it("is rejected as an unknown option", () => {
    const { stdout, stderr } = run(["audit", "-c", configPath, "--format", "json", "--external"])
    expect(stderr).toContain("unknown option '--external'")
    expect(stdout).toBe("")
  })
})

describe("audit --help", () => {
  it("lists --unsealed and the external status", () => {
    const stdout = execFileSync(TSX, [CLI_SRC, "audit", "--help"], { cwd: tmpDir, encoding: "utf-8" })
    expect(stdout).toContain("--unsealed")
    expect(stdout).toMatch(/--status[\s\S]*?external[\s\S]*?--strict/)
  })
})
