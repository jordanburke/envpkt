import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-keygen-cli-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const run = (
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
): { stdout: string; stderr: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      cwd: opts?.cwd ?? tmpDir,
      env: { ...process.env, ...opts?.env },
      encoding: "utf-8",
      timeout: 15000,
    })
    return { stdout, stderr: "", status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 }
  }
}

describe("envpkt keygen", () => {
  it.skipIf(!ageInstalled)("generates key to custom output path", () => {
    const keyPath = join(tmpDir, "test-key.txt")
    const result = run(["keygen", "-o", keyPath])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Generated")
    expect(result.stdout).toContain("Recipient:")
    expect(result.stdout).toContain("age1")
    expect(existsSync(keyPath)).toBe(true)
  })

  it.skipIf(!ageInstalled)("refuses to overwrite existing key", () => {
    const keyPath = join(tmpDir, "existing-key.txt")
    writeFileSync(keyPath, "existing")

    const result = run(["keygen", "-o", keyPath])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("already exists")
  })

  it.skipIf(!ageInstalled)("overwrites with --force", () => {
    const keyPath = join(tmpDir, "force-key.txt")
    writeFileSync(keyPath, "old content")

    const result = run(["keygen", "--force", "-o", keyPath])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Generated")

    const content = readFileSync(keyPath, "utf-8")
    expect(content).toContain("AGE-SECRET-KEY-")
  })

  it.skipIf(!ageInstalled)("updates envpkt.toml when present", () => {
    const keyPath = join(tmpDir, "key.txt")
    writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n\n[identity]\nname = "test"\n`)

    const result = run(["keygen", "-o", keyPath], { cwd: tmpDir })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Updated")
    expect(result.stdout).toContain("identity.recipient")

    const config = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(config).toContain("recipient = ")
    expect(config).toContain("age1")
  })

  it.skipIf(!ageInstalled)("shows next steps when no envpkt.toml exists", () => {
    const keyPath = join(tmpDir, "key.txt")
    const result = run(["keygen", "-o", keyPath])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Next steps")
    expect(result.stdout).toContain("envpkt init")
    expect(result.stdout).toContain("envpkt seal")
  })
})
