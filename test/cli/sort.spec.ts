import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadConfig } from "../../src/core/config.js"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

let tmpDir: string
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-sort-"))
  configPath = join(tmpDir, "envpkt.toml")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

type RunResult = { stdout: string; status: number }

const run = (args: string[]): RunResult => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      cwd: tmpDir,
      stdio: "pipe",
      encoding: "utf-8",
    })
    return { stdout, status: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 }
  }
}

const unsortedConfig = `version = 1

[secret.ZEBRA]
service = "z"

[env.BANANA]
value = "yellow"

[secret.APPLE]
service = "a"

[env.AVOCADO]
value = "green"
`

describe("envpkt sort", () => {
  it("groups env above secret and alphabetizes", () => {
    writeFileSync(configPath, unsortedConfig)
    const { status, stdout } = run(["sort", "-c", configPath])
    expect(status).toBe(0)
    expect(stdout).toContain("Sorted")

    const content = readFileSync(configPath, "utf-8")
    const envAvo = content.indexOf("[env.AVOCADO]")
    const envBan = content.indexOf("[env.BANANA]")
    const secApp = content.indexOf("[secret.APPLE]")
    const secZeb = content.indexOf("[secret.ZEBRA]")
    expect(envAvo).toBeLessThan(envBan)
    expect(envBan).toBeLessThan(secApp)
    expect(secApp).toBeLessThan(secZeb)

    // Still parseable.
    expect(loadConfig(configPath).isRight()).toBe(true)
  })

  it("--dry-run does not modify the file", () => {
    writeFileSync(configPath, unsortedConfig)
    const { status, stdout } = run(["sort", "-c", configPath, "--dry-run"])
    expect(status).toBe(0)
    expect(stdout).toContain("Preview")
    expect(readFileSync(configPath, "utf-8")).toBe(unsortedConfig)
  })

  it("reports 'Already sorted' when run on an already-sorted file", () => {
    writeFileSync(configPath, unsortedConfig)
    run(["sort", "-c", configPath])
    const { status, stdout } = run(["sort", "-c", configPath])
    expect(status).toBe(0)
    expect(stdout).toContain("Already sorted")
  })

  it("is idempotent (output unchanged on second run)", () => {
    writeFileSync(configPath, unsortedConfig)
    run(["sort", "-c", configPath])
    const after1 = readFileSync(configPath, "utf-8")
    run(["sort", "-c", configPath])
    const after2 = readFileSync(configPath, "utf-8")
    expect(after2).toBe(after1)
  })
})

describe("inspect --sort", () => {
  it("displays secrets alphabetically without modifying the file", () => {
    writeFileSync(configPath, unsortedConfig)
    const beforeHash = readFileSync(configPath, "utf-8")

    const { stdout } = run(["inspect", "-c", configPath, "--sort"])
    const appleIdx = stdout.indexOf("APPLE")
    const zebraIdx = stdout.indexOf("ZEBRA")
    expect(appleIdx).toBeGreaterThan(-1)
    expect(appleIdx).toBeLessThan(zebraIdx)

    // File untouched.
    expect(readFileSync(configPath, "utf-8")).toBe(beforeHash)
  })

  it("preserves insertion order without --sort", () => {
    writeFileSync(configPath, unsortedConfig)
    const { stdout } = run(["inspect", "-c", configPath])
    const appleIdx = stdout.indexOf("APPLE")
    const zebraIdx = stdout.indexOf("ZEBRA")
    // In unsortedConfig ZEBRA appears before APPLE.
    expect(zebraIdx).toBeLessThan(appleIdx)
  })
})

describe("audit --sort", () => {
  it("displays secrets alphabetically within each status bucket", () => {
    writeFileSync(
      configPath,
      `version = 1

[secret.ZEBRA]
service = "z"
created = "2026-01-01"
expires = "2027-06-01"

[secret.APPLE]
service = "a"
created = "2026-01-01"
expires = "2027-06-01"

[secret.MANGO]
service = "m"
created = "2026-01-01"
expires = "2027-06-01"
`,
    )

    const { stdout } = run(["audit", "-c", configPath, "--sort"])
    const appleIdx = stdout.indexOf("APPLE")
    const mangoIdx = stdout.indexOf("MANGO")
    const zebraIdx = stdout.indexOf("ZEBRA")
    expect(appleIdx).toBeGreaterThan(-1)
    expect(appleIdx).toBeLessThan(mangoIdx)
    expect(mangoIdx).toBeLessThan(zebraIdx)
  })
})
