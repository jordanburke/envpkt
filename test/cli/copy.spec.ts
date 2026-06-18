import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "smol-toml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { unsealSecrets } from "../../src/core/seal.js"
import type { SecretMeta } from "../../src/core/types.js"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

const ageInstalled = ((): boolean => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-copy-"))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const p = join(tmpDir, name)
  writeFileSync(p, content)
  return p
}

const cli = (args: string[], env?: Record<string, string>): { stdout: string; stderr: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      encoding: "utf-8",
      env: env ? { ...process.env, ...env } : process.env,
    })
    return { stdout, stderr: "", status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 }
  }
}

const ageKeygen = (path: string): string => {
  execFileSync("age-keygen", ["-o", path], { stdio: "pipe" })
  const line = readFileSync(path, "utf-8")
    .split("\n")
    .find((l) => l.startsWith("# public key:"))!
  return line.replace("# public key: ", "").trim()
}

const parseSecret = (path: string, key: string): SecretMeta =>
  (parse(readFileSync(path, "utf-8")) as { secret: Record<string, SecretMeta> }).secret[key]!

describe("envpkt copy", () => {
  it("copies an env entry between configs (no crypto)", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\npurpose = "app port"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string; purpose?: string }> }
    expect(parsed.env.PORT!.value).toBe("3000")
    expect(parsed.env.PORT!.purpose).toBe("app port")
  })

  it("renames with --as", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--as", "PORT2"])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string }> }
    expect(parsed.env.PORT2!.value).toBe("3000")
  })

  it("errors when the entry already exists in the destination without --force", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n\n[env.PORT]\nvalue = "9999"\n`)
    const { status, stderr } = cli(["copy", "PORT", "--from", a, "--to", b])
    expect(status).not.toBe(0)
    expect(stderr).toContain("already exists")
  })

  it("overwrites an existing entry with --force", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n\n[env.PORT]\nvalue = "9999"\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--force"])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string }> }
    expect(parsed.env.PORT!.value).toBe("3000")
  })

  it("errors when the key is not found in the source", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status, stderr } = cli(["copy", "MISSING", "--from", a, "--to", b])
    expect(status).not.toBe(0)
    expect(stderr).toContain("not found")
  })

  it("does not write on --dry-run", () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--dry-run"])
    expect(status).toBe(0)
    expect(readFileSync(b, "utf-8")).not.toContain("PORT")
  })

  it.skipIf(!ageInstalled)(
    "unseals from the source and reseals for the destination recipient",
    () => {
      const aKey = join(tmpDir, "a-key.txt")
      const bKey = join(tmpDir, "b-key.txt")
      const aRec = ageKeygen(aKey)
      const bRec = ageKeygen(bKey)

      const a = write(
        "a.toml",
        `version = 1\n\n[identity]\nname = "src"\nrecipient = "${aRec}"\nkey_file = "${aKey}"\n\n[secret.API_KEY]\nservice = "stripe"\ncreated = "2025-01-01"\n`,
      )
      // Seal the source value (resolved from the environment).
      const sealed = cli(["seal", "--config", a], { API_KEY: "sk-test-123" })
      expect(sealed.status).toBe(0)
      expect(readFileSync(a, "utf-8")).toContain("encrypted_value")

      const b = write(
        "b.toml",
        `version = 1\n\n[identity]\nname = "dest"\nrecipient = "${bRec}"\nkey_file = "${bKey}"\n`,
      )
      const { status } = cli(["copy", "API_KEY", "--from", a, "--to", b])
      expect(status).toBe(0)

      // The resealed value must decrypt with the DESTINATION's key, not the source's.
      const destMeta = parseSecret(b, "API_KEY")
      expect(destMeta.encrypted_value).toBeTruthy()
      const decrypted = unsealSecrets({ API_KEY: destMeta }, bKey)
      decrypted.fold(
        (err) => expect.fail(`expected decrypt to succeed, got ${err.message}`),
        (values) => expect(values.API_KEY).toBe("sk-test-123"),
      )
    },
    60_000,
  )

  it("copies metadata only (no value) for a secret with no sealed value", () => {
    const a = write("a.toml", `version = 1\n\n[secret.API_KEY]\nservice = "stripe"\ncreated = "2025-01-01"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "API_KEY", "--from", a, "--to", b])
    expect(status).toBe(0)
    const destMeta = parseSecret(b, "API_KEY")
    expect(destMeta.service).toBe("stripe")
    expect(destMeta.encrypted_value).toBeUndefined()
  }, 60_000)
})
