import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applySealedToml } from "../../src/cli/commands/seal.js"
import { decryptArmored, encryptArmored, generateAgeKeypair, parseIdentityFile } from "../../src/core/age.js"
import { loadConfig } from "../../src/core/config.js"

/**
 * Every envpkt.toml sealed before 0.18.0 holds ciphertext made by the `age` CLI. These tests prove
 * in-process age (typage) reads it, and that the `age` CLI reads what typage writes, so a user can
 * still unseal by hand with `age -d`. CI installs `age` only for this file.
 */

const ageInstalled = ((): boolean => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n"

const PLAINTEXTS: ReadonlyArray<readonly [string, string]> = [
  ["a plain token", "sk-test-123"],
  ["a PEM key with its final newline", PEM],
  ["edge spaces and a tab", "  padded\t"],
  ["an empty string", ""],
  ["multi-line text", "line1\nline2\r\nline3"],
  ["non-ASCII text", "pässwörd-🔑"],
  ["a leading byte-order mark", "\uFEFFvalue"],
]

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-age-interop-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** A key file as `age-keygen` writes it, from a CLI-generated keypair. */
const cliKeypair = (): { readonly keyFile: string; readonly content: string; readonly recipient: string } => {
  const content = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
  const recipient = content
    .split("\n")
    .find((l) => l.startsWith("# public key:"))!
    .replace("# public key: ", "")
    .trim()
  const keyFile = join(tmpDir, `key-${recipient.slice(4, 12)}.txt`)
  writeFileSync(keyFile, content, { mode: 0o600 })
  return { keyFile, content, recipient }
}

/** Encrypt the way envpkt 0.17 did: `age --encrypt --recipient R --armor`, output trimmed. */
const cliEncrypt = (plaintext: string, recipient: string): string =>
  execFileSync("age", ["--encrypt", "--recipient", recipient, "--armor"], {
    input: plaintext,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim()

const cliDecrypt = (armored: string, keyFile: string): string =>
  execFileSync("age", ["--decrypt", "--identity", keyFile], {
    input: armored,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  })

describe.skipIf(!ageInstalled)("age CLI ↔ typage interop", { timeout: 60_000 }, () => {
  it.each(PLAINTEXTS)("typage decrypts what the age CLI encrypted: %s", async (_label, plaintext) => {
    const { content, recipient } = cliKeypair()
    const identities = parseIdentityFile(content).orThrow()
    expect((await decryptArmored(cliEncrypt(plaintext, recipient), identities)).orThrow()).toBe(plaintext)
  })

  it.each(PLAINTEXTS)("the age CLI decrypts what typage encrypted: %s", async (_label, plaintext) => {
    const { keyFile, recipient } = cliKeypair()
    const armored = (await encryptArmored(plaintext, recipient)).orThrow()
    expect(cliDecrypt(armored, keyFile)).toBe(plaintext)
  })

  it("the age CLI uses a key typage generated", async () => {
    const { identity, recipient } = (await generateAgeKeypair()).orThrow()
    const keyFile = join(tmpDir, "typage-key.txt")
    writeFileSync(keyFile, `# public key: ${recipient}\n${identity}\n`, { mode: 0o600 })
    expect(cliDecrypt(cliEncrypt("value", recipient), keyFile)).toBe("value")
  })

  it("tries every key in a key file, as the age CLI does, when only the second matches", async () => {
    const first = cliKeypair()
    const second = cliKeypair()
    const twoKeys = `${first.content}\n${second.content}`
    const armored = cliEncrypt("value", second.recipient)
    expect((await decryptArmored(armored, parseIdentityFile(twoKeys).orThrow())).orThrow()).toBe("value")
  })

  it("writes the same envpkt.toml shape as a CLI-sealed value, and both tools unseal it", async () => {
    const { keyFile, content, recipient } = cliKeypair()
    const raw = `version = 1\n\n[identity]\nname = "test"\nrecipient = "${recipient}"\n\n[secret.TLS_KEY]\nservice = "tls"\n`
    const typageArmored = (await encryptArmored(PEM, recipient)).orThrow()
    const cliArmored = cliEncrypt(PEM, recipient)

    const typageToml = applySealedToml(raw, { TLS_KEY: { encrypted_value: typageArmored } })
    const cliToml = applySealedToml(raw, { TLS_KEY: { encrypted_value: cliArmored } })
    // Ciphertext differs on every run; the layout around it must not.
    const shape = (toml: string): string => toml.replace(/-----BEGIN[\s\S]*?END AGE ENCRYPTED FILE-----/, "<armor>")
    expect(shape(typageToml)).toBe(shape(cliToml))
    expect(typageArmored.split("\n").map((l) => l.length)).toEqual(cliArmored.split("\n").map((l) => l.length))

    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, typageToml)
    const sealed = loadConfig(configPath).orThrow().secret!["TLS_KEY"]!.encrypted_value!
    expect((await decryptArmored(sealed, parseIdentityFile(content).orThrow())).orThrow()).toBe(PEM)
    expect(cliDecrypt(sealed, keyFile)).toBe(PEM)
  })
})
