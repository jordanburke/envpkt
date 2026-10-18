import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "smol-toml"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ageEncrypt, unsealSecrets } from "../../src/core/seal.js"
import { unwrapAgentKey } from "../../src/fnox/identity.js"
import type { SecretMeta } from "../../src/core/types.js"
import { ageKeygen, recipientOf } from "../helpers/age.js"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

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

/** Write a fresh age key file to `path` and return its recipient. */
const writeKeyFile = async (path: string): Promise<string> => {
  const keyFileText = await ageKeygen()
  writeFileSync(path, keyFileText, { mode: 0o600 })
  return recipientOf(keyFileText)
}

const parseSecret = (path: string, key: string): SecretMeta =>
  (parse(readFileSync(path, "utf-8")) as { secret: Record<string, SecretMeta> }).secret[key]!

describe("envpkt copy", () => {
  it("copies an env entry between configs (no crypto)", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\npurpose = "app port"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string; purpose?: string }> }
    expect(parsed.env.PORT!.value).toBe("3000")
    expect(parsed.env.PORT!.purpose).toBe("app port")
  })

  it("renames with --as", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--as", "PORT2"])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string }> }
    expect(parsed.env.PORT2!.value).toBe("3000")
  })

  it("errors when the entry already exists in the destination without --force", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n\n[env.PORT]\nvalue = "9999"\n`)
    const { status, stderr } = cli(["copy", "PORT", "--from", a, "--to", b])
    expect(status).not.toBe(0)
    expect(stderr).toContain("already exists")
  })

  it("overwrites an existing entry with --force", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n\n[env.PORT]\nvalue = "9999"\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--force"])
    expect(status).toBe(0)
    const parsed = parse(readFileSync(b, "utf-8")) as { env: Record<string, { value?: string }> }
    expect(parsed.env.PORT!.value).toBe("3000")
  })

  it("--force replaces an existing entry in place, leaving every other line alone", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const before = `version = 1

[env.ABOVE]
value = "a"

[env.PORT]
value = "9999"

[env.BELOW]
value = "b"
`
    const b = write("b.toml", before)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--force"])
    expect(status).toBe(0)
    expect(readFileSync(b, "utf-8")).toBe(before.replace(`value = "9999"`, `value = "3000"`))
  })

  it("--force keeps the destination's created on an existing secret", async () => {
    const a = write(
      "a.toml",
      `version = 1\n\n[secret.TOKEN]\nservice = "todoist"\npurpose = "oauth"\ncreated = "2026-01-01"\n`,
    )
    const before = `version = 1

[secret.ABOVE]
service = "a"

[secret.TOKEN]
service = "todoist"
created = "2026-06-01"

[secret.BELOW]
service = "b"
`
    const b = write("b.toml", before)
    const { status } = cli(["copy", "TOKEN", "--from", a, "--to", b, "--force"])
    expect(status).toBe(0)
    expect(readFileSync(b, "utf-8")).toBe(
      before.replace(`service = "todoist"\n`, `service = "todoist"\npurpose = "oauth"\n`),
    )
  }, 60_000)

  it("stamps today's created on a secret new to the destination", async () => {
    const a = write("a.toml", `version = 1\n\n[secret.TOKEN]\nservice = "todoist"\ncreated = "2026-01-01"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "TOKEN", "--from", a, "--to", b])
    expect(status).toBe(0)
    expect(parseSecret(b, "TOKEN").created).toBe(new Date().toISOString().split("T")[0])
  }, 60_000)

  it("errors when the key is not found in the source", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status, stderr } = cli(["copy", "MISSING", "--from", a, "--to", b])
    expect(status).not.toBe(0)
    expect(stderr).toContain("not found")
  })

  it("does not write on --dry-run", async () => {
    const a = write("a.toml", `version = 1\n\n[env.PORT]\nvalue = "3000"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "PORT", "--from", a, "--to", b, "--dry-run"])
    expect(status).toBe(0)
    expect(readFileSync(b, "utf-8")).not.toContain("PORT")
  })

  it("unseals from the source and reseals for the destination recipient", async () => {
    const aKey = join(tmpDir, "a-key.txt")
    const bKey = join(tmpDir, "b-key.txt")
    const aRec = await writeKeyFile(aKey)
    const bRec = await writeKeyFile(bKey)

    const a = write(
      "a.toml",
      `version = 1\n\n[identity]\nname = "src"\nrecipient = "${aRec}"\nkey_file = "${aKey}"\n\n[secret.API_KEY]\nservice = "stripe"\ncreated = "2025-01-01"\n`,
    )
    // Seal the source value (resolved from the environment).
    const sealed = cli(["seal", "--config", a], { API_KEY: "sk-test-123" })
    expect(sealed.status).toBe(0)
    expect(readFileSync(a, "utf-8")).toContain("encrypted_value")

    const b = write("b.toml", `version = 1\n\n[identity]\nname = "dest"\nrecipient = "${bRec}"\nkey_file = "${bKey}"\n`)
    const { status } = cli(["copy", "API_KEY", "--from", a, "--to", b])
    expect(status).toBe(0)

    // The resealed value must decrypt with the DESTINATION's key, not the source's.
    const destMeta = parseSecret(b, "API_KEY")
    expect(destMeta.encrypted_value).toBeTruthy()
    const decrypted = await unsealSecrets({ API_KEY: destMeta }, unwrapAgentKey(bKey).orThrow())
    decrypted.fold(
      (err) => expect.fail(`expected decrypt to succeed, got ${err.message}`),
      (values) => expect(values.API_KEY).toBe("sk-test-123"),
    )
  }, 60_000)

  it("keeps a sealed value's edge whitespace when it reseals for the destination", async () => {
    const aKey = join(tmpDir, "a-key.txt")
    const bKey = join(tmpDir, "b-key.txt")
    const aRec = await writeKeyFile(aKey)
    const bRec = await writeKeyFile(bKey)

    // Sealed by hand, as `age -r` would: the PEM keeps its final newline.
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n"
    const ciphertext = (await ageEncrypt(pem, aRec)).orThrow()
    const a = write(
      "a.toml",
      `version = 1\n\n[identity]\nname = "src"\nrecipient = "${aRec}"\nkey_file = "${aKey}"\n\n[secret.TLS_KEY]\nservice = "tls"\ncreated = "2025-01-01"\nencrypted_value = """\n${ciphertext}\n"""\n`,
    )
    const b = write("b.toml", `version = 1\n\n[identity]\nname = "dest"\nrecipient = "${bRec}"\nkey_file = "${bKey}"\n`)
    expect(cli(["copy", "TLS_KEY", "--from", a, "--to", b]).status).toBe(0)

    const unsealed = await unsealSecrets({ TLS_KEY: parseSecret(b, "TLS_KEY") }, unwrapAgentKey(bKey).orThrow())
    expect(unsealed.orThrow()).toEqual({ TLS_KEY: pem })
  }, 60_000)

  it("copies metadata only (no value) for a secret with no sealed value", async () => {
    const a = write("a.toml", `version = 1\n\n[secret.API_KEY]\nservice = "stripe"\ncreated = "2025-01-01"\n`)
    const b = write("b.toml", `version = 1\n`)
    const { status } = cli(["copy", "API_KEY", "--from", a, "--to", b])
    expect(status).toBe(0)
    const destMeta = parseSecret(b, "API_KEY")
    expect(destMeta.service).toBe("stripe")
    expect(destMeta.encrypted_value).toBeUndefined()
  }, 60_000)
})
