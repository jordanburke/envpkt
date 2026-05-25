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

const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

const today = new Date().toISOString().slice(0, 10)

let tmpDir: string
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-rotate-"))
  configPath = join(tmpDir, "envpkt.toml")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

type RunResult = { stdout: string; status: number }

const run = (args: string[], input?: string): RunResult => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      cwd: tmpDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
      input,
    })
    return { stdout, status: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 }
  }
}

describe("secret rotate (unsealed)", () => {
  it("stamps last_rotated_at on a secret with no encrypted_value", () => {
    writeFileSync(
      configPath,
      `version = 1

[secret.PLAIN_KEY]
service = "test"
created = "2024-01-01"
`,
    )

    const { status, stdout } = run(["secret", "rotate", "PLAIN_KEY", "-c", configPath])
    expect(status).toBe(0)
    expect(stdout).toContain("Stamped")
    expect(stdout).toContain("unsealed")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain(`last_rotated_at = "${today}"`)
    // Config still loads cleanly
    expect(loadConfig(configPath).isRight()).toBe(true)
  })

  it("refuses to rotate an alias", () => {
    writeFileSync(
      configPath,
      `version = 1

[secret.REAL_KEY]
service = "real"

[secret.ALIAS_KEY]
from_key = "secret.REAL_KEY"
`,
    )

    const { status, stdout } = run(["secret", "rotate", "ALIAS_KEY", "-c", configPath])
    expect(status).toBe(1)
    expect(stdout).toContain("alias")
  })

  it("errors when the secret does not exist", () => {
    writeFileSync(configPath, `version = 1\n`)
    const { status, stdout } = run(["secret", "rotate", "NOPE", "-c", configPath])
    expect(status).toBe(1)
    expect(stdout).toContain("not found")
  })

  it("--dry-run does not modify the file", () => {
    const original = `version = 1

[secret.PLAIN_KEY]
service = "test"
created = "2024-01-01"
`
    writeFileSync(configPath, original)

    const { status, stdout } = run(["secret", "rotate", "PLAIN_KEY", "-c", configPath, "--dry-run"])
    expect(status).toBe(0)
    expect(stdout).toContain("Preview")
    expect(readFileSync(configPath, "utf-8")).toBe(original)
  })
})

describe.skipIf(!ageInstalled)("secret rotate (sealed)", () => {
  let recipient: string
  let identityPath: string

  beforeEach(() => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    recipient = recipientLine!.replace("# public key: ", "").trim()
    identityPath = join(tmpDir, "key.txt")
    writeFileSync(identityPath, keygenOutput)
  })

  it("reseals a sealed secret and stamps last_rotated_at when value comes via stdin", () => {
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.API_KEY]
service = "test"
encrypted_value = """
-----BEGIN AGE ENCRYPTED FILE-----
placeholder
-----END AGE ENCRYPTED FILE-----
"""
`,
    )

    const { status, stdout } = run(["secret", "rotate", "API_KEY", "-c", configPath], "new-secret-value\n")
    expect(status).toBe(0)
    expect(stdout).toContain("Rotated")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain(`last_rotated_at = "${today}"`)
    expect(content).toContain("-----BEGIN AGE ENCRYPTED FILE-----")
    expect(content).not.toContain("placeholder")
    expect(loadConfig(configPath).isRight()).toBe(true)
  })

  it("cancels with no changes when stdin is empty", () => {
    const original = `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.API_KEY]
service = "test"
encrypted_value = """
-----BEGIN AGE ENCRYPTED FILE-----
placeholder
-----END AGE ENCRYPTED FILE-----
"""
`
    writeFileSync(configPath, original)

    // Empty input simulates user hitting enter on the prompt
    const { status, stdout } = run(["secret", "rotate", "API_KEY", "-c", configPath], "")
    expect(status).toBe(1)
    expect(stdout).toContain("Cancelled")
    expect(readFileSync(configPath, "utf-8")).toBe(original)
  })

  it("errors when sealed secret has no recipient configured", () => {
    writeFileSync(
      configPath,
      `version = 1

[secret.API_KEY]
service = "test"
encrypted_value = """
ciphertext-placeholder
"""
`,
    )

    const { status, stdout } = run(["secret", "rotate", "API_KEY", "-c", configPath], "new-value\n")
    expect(status).toBe(2)
    expect(stdout).toContain("identity.recipient")
  })
})
