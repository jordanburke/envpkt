import { generateHybridIdentity, identityToRecipient } from "age-encryption"
import { describe, expect, it } from "vitest"

import { decryptArmored, encryptArmored, generateAgeKeypair, parseIdentityFile } from "../../src/core/age.js"

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n"

const keypair = async (): Promise<{ readonly identity: string; readonly recipient: string }> =>
  (await generateAgeKeypair()).orThrow()

describe("generateAgeKeypair", () => {
  it("returns an X25519 identity and its age1 recipient", async () => {
    const { identity, recipient } = await keypair()
    expect(identity).toMatch(/^AGE-SECRET-KEY-1[0-9A-Z]+$/)
    expect(recipient).toMatch(/^age1[0-9a-z]+$/)
  })
})

describe("encryptArmored / decryptArmored", () => {
  it("writes age armor with no trailing newline", async () => {
    const { recipient } = await keypair()
    const armored = (await encryptArmored("value", recipient)).orThrow()
    expect(armored.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")).toBe(true)
    expect(armored.endsWith("\n-----END AGE ENCRYPTED FILE-----")).toBe(true)
  })

  it.each([
    ["a plain token", "sk-test-123"],
    ["a PEM key with its final newline", PEM],
    ["edge spaces and a tab", "  padded\t"],
    ["an empty string", ""],
    ["multi-line text", "line1\nline2\r\nline3"],
    ["non-ASCII text", "pässwörd-🔑"],
    ["a leading byte-order mark", "\uFEFFvalue"],
  ])("round-trips %s byte for byte", async (_label, plaintext) => {
    const { identity, recipient } = await keypair()
    const armored = (await encryptArmored(plaintext, recipient)).orThrow()
    expect((await decryptArmored(armored, [identity])).orThrow()).toBe(plaintext)
  })

  it("decrypts when any one of several identities matches", async () => {
    const wrong = await keypair()
    const right = await keypair()
    const armored = (await encryptArmored("value", right.recipient)).orThrow()
    expect((await decryptArmored(armored, [wrong.identity, right.identity])).orThrow()).toBe("value")
  })

  it("round-trips with a post-quantum (hybrid) identity", async () => {
    const identity = await generateHybridIdentity()
    const armored = (await encryptArmored("value", await identityToRecipient(identity))).orThrow()
    expect(identity.startsWith("AGE-SECRET-KEY-PQ-1")).toBe(true)
    expect((await decryptArmored(armored, [identity])).orThrow()).toBe("value")
  })

  it.each([
    ["the only identity", 0, "identity 1"],
    ["the second identity", 1, "identity 2"],
  ])("names a malformed key by position and never echoes it: %s", async (_label, badIndex, position) => {
    const { identity, recipient } = await keypair()
    const armored = (await encryptArmored("value", recipient)).orThrow()
    // Flip the last character: still the right shape, but the bech32 checksum fails.
    const malformed = identity.slice(0, -1) + (identity.endsWith("Q") ? "P" : "Q")
    const identities = badIndex === 0 ? [malformed] : [identity, malformed]
    const message = (await decryptArmored(armored, identities)).fold(
      (err) => err.message,
      () => "ok",
    )
    expect(message).not.toContain(malformed.slice("AGE-SECRET-KEY-1".length, -6))
    expect(message).toContain(position)
  })

  it("tolerates whitespace around the armor, as a TOML multi-line string leaves it", async () => {
    const { identity, recipient } = await keypair()
    const armored = (await encryptArmored("value", recipient)).orThrow()
    expect((await decryptArmored(`\n${armored}\n`, [identity])).orThrow()).toBe("value")
  })

  it("fails with DecryptFailed when no identity matches", async () => {
    const { recipient } = await keypair()
    const other = await keypair()
    const armored = (await encryptArmored("value", recipient)).orThrow()
    const result = await decryptArmored(armored, [other.identity])
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => {
        expect(err._tag).toBe("DecryptFailed")
        expect(err.message).toContain("no identity matched")
      },
      () => expect.unreachable(),
    )
  })

  it("fails with DecryptFailed when given no identities", async () => {
    const { recipient } = await keypair()
    const armored = (await encryptArmored("value", recipient)).orThrow()
    const result = await decryptArmored(armored, [])
    expect(result.isLeft()).toBe(true)
  })

  it("fails with DecryptFailed on text that is not age armor", async () => {
    const { identity } = await keypair()
    const result = await decryptArmored("not armor", [identity])
    expect(
      result.fold(
        (err) => err._tag,
        () => "ok",
      ),
    ).toBe("DecryptFailed")
  })

  it("fails with EncryptFailed on an invalid recipient", async () => {
    const result = await encryptArmored("value", "age1bogus")
    expect(
      result.fold(
        (err) => err._tag,
        () => "ok",
      ),
    ).toBe("EncryptFailed")
  })
})

describe("parseIdentityFile", () => {
  it("reads every secret key line, skipping comments and blank lines", async () => {
    const a = await keypair()
    const b = await keypair()
    const content = `# created: 2026-10-17\n# public key: ${a.recipient}\n${a.identity}\n\n${b.identity}\r\n`
    expect(parseIdentityFile(content).orThrow()).toEqual([a.identity, b.identity])
  })

  it("reads a post-quantum hybrid secret key line", () => {
    expect(parseIdentityFile("AGE-SECRET-KEY-PQ-1QQQQ\n").orThrow()).toEqual(["AGE-SECRET-KEY-PQ-1QQQQ"])
  })

  it.each([
    ["an empty file", "", { _tag: "NoIdentityKey" }],
    ["only comments", "# public key: age1xyz\n", { _tag: "NoIdentityKey" }],
    [
      "a passphrase-protected (armored) key file",
      "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n-----END AGE ENCRYPTED FILE-----\n",
      { _tag: "PassphraseProtectedIdentity" },
    ],
    [
      "a passphrase-protected (binary) key file",
      "age-encryption.org/v1\n-> scrypt abc 18\n",
      { _tag: "PassphraseProtectedIdentity" },
    ],
    ["a plugin key", "# yubikey\nAGE-PLUGIN-YUBIKEY-1XYZ\n", { _tag: "UnsupportedIdentity", kind: "plugin", line: 2 }],
    [
      "an SSH private key",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl\n",
      { _tag: "UnsupportedIdentity", kind: "ssh", line: 1 },
    ],
    [
      "a PEM RSA key, which the age CLI reads as SSH",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n",
      { _tag: "UnsupportedIdentity", kind: "ssh", line: 1 },
    ],
    ["an unrecognized line", "AGE-SECRET-KEY-1ABC\nhello\n", { _tag: "UnsupportedIdentity", kind: "unknown", line: 2 }],
  ])("rejects %s", (_label, content, expected) => {
    expect(
      parseIdentityFile(content).fold(
        (err) => err,
        () => undefined,
      ),
    ).toEqual(expected)
  })

  it("never puts the offending line's content in the error", () => {
    const err = parseIdentityFile("not-a-key-but-maybe-secret\n").fold(
      (e) => e,
      () => undefined,
    )
    expect(JSON.stringify(err)).not.toContain("not-a-key-but-maybe-secret")
  })
})
