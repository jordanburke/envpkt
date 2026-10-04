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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-headers-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/**
 * Run the CLI the way Claude Code runs a project headersHelper: cwd = project dir, and an
 * env holding only HOME and PATH (credential-looking variables are stripped).
 */
const run = (
  args: string[],
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync(TSX, [CLI_SRC, ...args], {
    cwd: tmpDir,
    env: { HOME: tmpDir, PATH: process.env.PATH ?? "", ...extraEnv },
    encoding: "utf-8",
    timeout: 15000,
  })
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 }
}

const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

/** Seal `values` with a fresh age key in tmpDir; return TOML for [identity] + one [secret.*] per key. */
const sealedSecrets = (values: Record<string, string>): { identity: string; secrets: Record<string, string> } => {
  const keygen = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
  const recipient = keygen
    .split("\n")
    .find((l) => l.startsWith("# public key:"))!
    .replace("# public key: ", "")
    .trim()
  writeFileSync(join(tmpDir, "identity.txt"), keygen)
  const secrets = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      execFileSync("age", ["--encrypt", "-r", recipient, "--armor"], { input: value, encoding: "utf-8" }),
    ]),
  )
  return {
    identity: `[identity]\nname = "test"\nrecipient = "${recipient}"\nkey_file = "identity.txt"\n`,
    secrets,
  }
}

describe("envpkt headers", () => {
  it.skipIf(!ageInstalled)("prints only a JSON object on stdout under a stripped env", () => {
    const { identity, secrets } = sealedSecrets({ GH_KEY: "gh-token" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n${identity}\n[secret.GH_KEY]\nservice = "github"\nmcp = [{ server = "civala-github" }]\nencrypted_value = """\n${secrets.GH_KEY}"""\n`,
    )

    const result = run(["headers"], { CLAUDE_CODE_MCP_SERVER_NAME: "civala-github" })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ Authorization: "Bearer gh-token" })
  })

  it.skipIf(!ageInstalled)("resolves an aliased key (from_key)", () => {
    const { identity, secrets } = sealedSecrets({ SOURCE: "shared-value" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n${identity}\n[secret.SOURCE]\nencrypted_value = """\n${secrets.SOURCE}"""\n\n[secret.ALIAS]\nfrom_key = "secret.SOURCE"\nmcp = [{ server = "corpus" }]\n`,
    )

    const result = run(["headers", "corpus"])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ Authorization: "Bearer shared-value" })
  })

  it.skipIf(!ageInstalled)("resolves namespaced keys, including a per-entry namespace opt-out", () => {
    const { identity, secrets } = sealedSecrets({ API_KEY: "prefixed", RAW_KEY: "unprefixed" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n[namespace]\nprefix = "CIV"\n\n${identity}\n` +
        `[secret.API_KEY]\nmcp = [{ server = "admin" }]\nencrypted_value = """\n${secrets.API_KEY}"""\n\n` +
        `[secret.RAW_KEY]\nnamespace = ""\nmcp = [{ server = "admin", header = "x-raw", scheme = "" }]\nencrypted_value = """\n${secrets.RAW_KEY}"""\n`,
    )

    const result = run(["headers", "admin"])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ Authorization: "Bearer prefixed", "x-raw": "unprefixed" })
  })

  it.skipIf(!ageInstalled)('sends the raw value with scheme = "" and header = "x-api-key"', () => {
    const { identity, secrets } = sealedSecrets({ CF_KEY: "cf-raw" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n${identity}\n[secret.CF_KEY]\nmcp = [{ server = "cloudflare", header = "x-api-key", scheme = "" }]\nencrypted_value = """\n${secrets.CF_KEY}"""\n`,
    )

    const result = run(["headers", "cloudflare"])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ "x-api-key": "cf-raw" })
  })

  it.skipIf(!ageInstalled)("exits non-zero naming the server when nothing matches, with empty stdout", () => {
    const { identity, secrets } = sealedSecrets({ GH_KEY: "gh-token" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n${identity}\n[secret.GH_KEY]\nmcp = [{ server = "civala-github" }]\nencrypted_value = """\n${secrets.GH_KEY}"""\n`,
    )

    const result = run(["headers", "unknown-server"])

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("unknown-server")
  })

  it("exits non-zero naming the server when a value does not resolve", () => {
    writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n\n[secret.GH_KEY]\nmcp = [{ server = "civala-github" }]\n`)

    const result = run(["headers", "civala-github"])

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("civala-github")
  })

  it.skipIf(!ageInstalled)("prefers the [server] argument over CLAUDE_CODE_MCP_SERVER_NAME", () => {
    const { identity, secrets } = sealedSecrets({ A: "a-val", B: "b-val" })
    writeFileSync(
      join(tmpDir, "envpkt.toml"),
      `version = 1\n\n${identity}\n` +
        `[secret.A]\nmcp = [{ server = "one" }]\nencrypted_value = """\n${secrets.A}"""\n\n` +
        `[secret.B]\nmcp = [{ server = "two" }]\nencrypted_value = """\n${secrets.B}"""\n`,
    )

    const result = run(["headers", "two"], { CLAUDE_CODE_MCP_SERVER_NAME: "one" })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ Authorization: "Bearer b-val" })
  })

  it("exits non-zero when neither [server] nor CLAUDE_CODE_MCP_SERVER_NAME is given", () => {
    writeFileSync(join(tmpDir, "envpkt.toml"), `version = 1\n`)

    const result = run(["headers"])

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("CLAUDE_CODE_MCP_SERVER_NAME")
  })
})
