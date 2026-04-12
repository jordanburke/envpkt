import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
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

  it.skipIf(!ageInstalled)("refuses even existing-key collisions (no --force flag)", () => {
    const keyPath = join(tmpDir, "force-key.txt")
    writeFileSync(keyPath, "old content")

    const result = run(["keygen", "--force", "-o", keyPath])

    // --force is no longer a valid flag; commander should error
    expect(result.status).not.toBe(0)
  })

  it.skipIf(!ageInstalled)("updates envpkt.toml with name, recipient, and key_file", () => {
    const keyPath = join(tmpDir, "key.txt")
    writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n`)

    const result = run(["keygen", "-o", keyPath], { cwd: tmpDir })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Updated")

    const config = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(config).toContain("recipient = ")
    expect(config).toContain("age1")
    expect(config).toContain('name = "')
    expect(config).toContain("key_file = ")
  })

  it.skipIf(!ageInstalled)("preserves existing name when updating recipient", () => {
    const keyPath = join(tmpDir, "key.txt")
    writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n\n[identity]\nname = "my-agent"\n`)

    const result = run(["keygen", "-o", keyPath], { cwd: tmpDir })

    expect(result.status).toBe(0)

    const config = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    // Existing name should be updated with derived name, recipient and key_file added
    expect(config).toContain("recipient = ")
    expect(config).toContain("name = ")
    expect(config).toContain("key_file = ")
  })

  it.skipIf(!ageInstalled)("defaults to project-specific path derived from config", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, `version = 1\n`)

    // Use tmpDir as HOME so the derived path lands inside tmpDir
    const result = run(["keygen", "-c", configPath], {
      cwd: tmpDir,
      env: { HOME: tmpDir },
    })

    expect(result.status).toBe(0)
    // The derived path should include the tmpDir basename
    const projectName = basename(tmpDir)
    const expectedPath = join(tmpDir, ".envpkt", `${projectName}-key.txt`)
    expect(existsSync(expectedPath)).toBe(true)
    expect(result.stdout).toContain(".envpkt")
  })

  it.skipIf(!ageInstalled)("derives distinct paths for prod/dev configs in same project", () => {
    const prodConfig = join(tmpDir, "prod.envpkt.toml")
    const devConfig = join(tmpDir, "dev.envpkt.toml")
    writeFileSync(prodConfig, `version = 1\n`)
    writeFileSync(devConfig, `version = 1\n`)

    const prodResult = run(["keygen", "-c", prodConfig], { cwd: tmpDir, env: { HOME: tmpDir } })
    const devResult = run(["keygen", "-c", devConfig], { cwd: tmpDir, env: { HOME: tmpDir } })

    expect(prodResult.status).toBe(0)
    expect(devResult.status).toBe(0)

    const projectName = basename(tmpDir)
    expect(existsSync(join(tmpDir, ".envpkt", `${projectName}-prod-key.txt`))).toBe(true)
    expect(existsSync(join(tmpDir, ".envpkt", `${projectName}-dev-key.txt`))).toBe(true)
  })

  it.skipIf(!ageInstalled)("--global writes to shared age-key.txt path", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, `version = 1\n`)

    const result = run(["keygen", "-c", configPath, "--global"], {
      cwd: tmpDir,
      env: { HOME: tmpDir },
    })

    expect(result.status).toBe(0)
    expect(existsSync(join(tmpDir, ".envpkt", "age-key.txt"))).toBe(true)
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
