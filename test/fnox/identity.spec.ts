import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { generateAgeKeypair } from "../../src/core/age.js"
import type { IdentityError } from "../../src/core/types.js"
import { describeIdentityError, parseIdentityKeys, unwrapAgentKey } from "../../src/fnox/identity.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-identity-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const newIdentity = async (): Promise<string> =>
  (await generateAgeKeypair()).fold(
    (err) => expect.unreachable(`keygen failed: ${err._tag}`),
    ({ identity }) => identity,
  )

const leftOf = <R>(result: { fold: <T>(l: (e: IdentityError) => T, r: (v: R) => T) => T }): IdentityError =>
  result.fold(
    (err) => err,
    () => expect.unreachable("Expected Left"),
  )

describe("unwrapAgentKey", () => {
  it("returns Left IdentityNotFound for nonexistent file", () => {
    const result = unwrapAgentKey(join(tmpDir, "nonexistent.age"))
    result.fold(
      (err) => {
        expect(err._tag).toBe("IdentityNotFound")
        if (err._tag === "IdentityNotFound") {
          expect(err.path).toContain("nonexistent.age")
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns every secret key in a plain identity file, skipping comments", async () => {
    const [first, second] = [await newIdentity(), await newIdentity()]
    const keyFile = join(tmpDir, "keys.txt")
    writeFileSync(keyFile, `# created: 2026-10-18T00:00:00Z\n# public key: age1example\n${first}\n\n${second}\n`)

    unwrapAgentKey(keyFile).fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (keys) => expect(keys).toEqual([first, second]),
    )
  })

  it("rejects a passphrase-protected key file, naming the file", () => {
    const keyFile = join(tmpDir, "wrapped.age")
    writeFileSync(
      keyFile,
      "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+\n-----END AGE ENCRYPTED FILE-----\n",
    )

    expect(leftOf(unwrapAgentKey(keyFile))).toEqual({ _tag: "PassphraseProtectedIdentity", source: keyFile })
  })

  it("rejects a plugin key with its line number", async () => {
    const keyFile = join(tmpDir, "plugin.txt")
    writeFileSync(keyFile, `${await newIdentity()}\nAGE-PLUGIN-YUBIKEY-1QQQQQQ\n`)

    expect(leftOf(unwrapAgentKey(keyFile))).toEqual({
      _tag: "UnsupportedIdentity",
      kind: "plugin",
      line: 2,
      source: keyFile,
    })
  })

  it("resolves absolute paths", () => {
    const absPath = join(tmpDir, "keys", "agent.age")
    const result = unwrapAgentKey(absPath)
    result.fold(
      (err) => {
        expect(err._tag).toBe("IdentityNotFound")
        if (err._tag === "IdentityNotFound") {
          expect(err.path).toBe(absPath)
        }
      },
      () => expect.unreachable("Expected Left for missing file"),
    )
  })
})

describe("parseIdentityKeys", () => {
  it("names the inline source in errors", () => {
    expect(leftOf(parseIdentityKeys("# just a comment\n", "ENVPKT_AGE_KEY"))).toEqual({
      _tag: "NoIdentityKey",
      source: "ENVPKT_AGE_KEY",
    })
  })
})

describe("describeIdentityError", () => {
  it("names the source and line, and never echoes key material", async () => {
    const identity = await newIdentity()
    const sshLine = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
    const keyFile = join(tmpDir, "mixed.txt")
    writeFileSync(keyFile, `${identity}\n${sshLine}\n`)

    const message = describeIdentityError(leftOf(unwrapAgentKey(keyFile)))
    expect(message).toContain(keyFile)
    expect(message).toContain("line 2")
    expect(message).toContain("SSH key")
    expect(message).not.toContain(identity.slice("AGE-SECRET-KEY-".length))
    expect(message).not.toContain("AAAAC3Nza")
  })

  it("for an inline passphrase-protected key, asks for the plain key instead of an age -d command", () => {
    const message = describeIdentityError({ _tag: "PassphraseProtectedIdentity", source: "ENVPKT_AGE_KEY" })
    expect(message).toContain("ENVPKT_AGE_KEY holds a passphrase-protected key")
    expect(message).not.toContain("age -d")
  })

  it("tells the user how to unwrap a passphrase-protected file", () => {
    const message = describeIdentityError({ _tag: "PassphraseProtectedIdentity", source: "/keys/wrapped.age" })
    expect(message).toContain("passphrase-protected")
    expect(message).toContain("age -d -o <plain-key-file> /keys/wrapped.age")
  })
})
