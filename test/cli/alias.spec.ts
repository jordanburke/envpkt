import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadConfig } from "../../src/core/config.js"

const CLI = join(__dirname, "..", "..", "dist", "cli.js")

const runCli = (args: string[], configPath: string): { stdout: string; stderr: string; exitCode: number } => {
  try {
    const stdout = execFileSync("node", [CLI, ...args, "-c", configPath], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { stdout, stderr: "", exitCode: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 }
  }
}

let tmpDir: string
let configPath: string

const baseToml = `version = 1

[secret.API_KEY]
service = "example"
purpose = "canonical"

[env.SERVICE_URL]
value = "https://api.example.com"
`

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-alias-cli-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, baseToml)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("envpkt secret alias", () => {
  it("writes a valid alias block and produces a parseable config", () => {
    const result = runCli(["secret", "alias", "LEGACY_API_KEY", "--from", "secret.API_KEY"], configPath)
    expect(result.exitCode).toBe(0)
    expect(result.stdout + result.stderr).toContain("Aliased")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('from_key = "secret.API_KEY"')

    loadConfig(configPath).fold(
      (err) => expect.unreachable(`Config should be valid: ${err._tag}`),
      (config) => {
        expect(config.secret!["LEGACY_API_KEY"]!.from_key).toBe("secret.API_KEY")
      },
    )
  })

  it("rejects cross-type alias (secret → env)", () => {
    const result = runCli(["secret", "alias", "BAD", "--from", "env.SERVICE_URL"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("must point at another secret")
  })

  it("rejects missing target", () => {
    const result = runCli(["secret", "alias", "BAD", "--from", "secret.NOPE"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not found")
  })

  it("rejects self-reference", () => {
    const result = runCli(["secret", "alias", "API_KEY", "--from", "secret.API_KEY"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cannot reference itself")
  })

  it("rejects alias target that is itself an alias", () => {
    runCli(["secret", "alias", "FIRST_ALIAS", "--from", "secret.API_KEY"], configPath)
    const result = runCli(["secret", "alias", "SECOND_ALIAS", "--from", "secret.FIRST_ALIAS"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("Chained aliases are not supported")
  })

  it("warns and exits on overwrite without --force", () => {
    runCli(["secret", "alias", "LEGACY_API_KEY", "--from", "secret.API_KEY"], configPath)
    const result = runCli(["secret", "alias", "LEGACY_API_KEY", "--from", "secret.API_KEY"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("already exists")
    expect(result.stderr).toContain("--force")
  })

  it("overwrites with --force and leaves a single block", () => {
    runCli(["secret", "alias", "LEGACY_API_KEY", "--from", "secret.API_KEY", "--purpose", "v1"], configPath)
    const result = runCli(
      ["secret", "alias", "LEGACY_API_KEY", "--from", "secret.API_KEY", "--purpose", "v2", "--force"],
      configPath,
    )
    expect(result.exitCode).toBe(0)

    const content = readFileSync(configPath, "utf-8")
    const occurrences = content.match(/\[secret\.LEGACY_API_KEY\]/g) ?? []
    expect(occurrences.length).toBe(1)
    expect(content).toContain('purpose = "v2"')
    expect(content).not.toContain('purpose = "v1"')
  })

  it("--dry-run previews without writing", () => {
    const before = readFileSync(configPath, "utf-8")
    const result = runCli(["secret", "alias", "NEW_ALIAS", "--from", "secret.API_KEY", "--dry-run"], configPath)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("from_key")
    const after = readFileSync(configPath, "utf-8")
    expect(after).toBe(before)
  })
})

describe("envpkt env alias", () => {
  it("writes a valid env alias block", () => {
    const result = runCli(["env", "alias", "LEGACY_URL", "--from", "env.SERVICE_URL"], configPath)
    expect(result.exitCode).toBe(0)

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('from_key = "env.SERVICE_URL"')

    loadConfig(configPath).fold(
      (err) => expect.unreachable(`Config should be valid: ${err._tag}`),
      (config) => {
        expect(config.env!["LEGACY_URL"]!.from_key).toBe("env.SERVICE_URL")
      },
    )
  })

  it("rejects cross-type alias (env → secret)", () => {
    const result = runCli(["env", "alias", "BAD", "--from", "secret.API_KEY"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("must point at another env")
  })

  it("rejects missing target", () => {
    const result = runCli(["env", "alias", "BAD", "--from", "env.NOPE"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not found")
  })

  it("warns and exits on overwrite without --force", () => {
    runCli(["env", "alias", "LEGACY_URL", "--from", "env.SERVICE_URL"], configPath)
    const result = runCli(["env", "alias", "LEGACY_URL", "--from", "env.SERVICE_URL"], configPath)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("already exists")
  })
})
