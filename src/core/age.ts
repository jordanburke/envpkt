import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { armor, Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption"
import { type Either, Left, type Option, Right, Try, tryCatch, tryCatchAsync } from "functype"

import type { IdentityFileError, KeygenError, SealError } from "./types.js"

/**
 * In-process age encryption via typage (`age-encryption`). This is the only module that imports
 * it. Ciphertext is age's ASCII armor, interoperable with the `age` CLI in both directions.
 */

/** Encrypt `plaintext` to an age recipient (`age1…`), returning armored text without a trailing newline. */
export const encryptArmored = (plaintext: string, recipient: string): Promise<Either<SealError, string>> =>
  tryCatchAsync(
    async () => {
      const encrypter = new Encrypter()
      encrypter.addRecipient(recipient)
      return armor.encode(await encrypter.encrypt(plaintext)).trim()
    },
    (err): SealError => ({ _tag: "EncryptFailed", key: "", message: `age encrypt failed: ${String(err)}` }),
  )

const decryptFailed = (message: string): SealError => ({
  _tag: "DecryptFailed",
  key: "",
  message: `age decrypt failed: ${message}`,
})

/** Mask any age secret key in an error message. typage's bech32 errors quote the key they rejected. */
const redactKeys = (message: string): string => message.replace(/AGE-SECRET-KEY-[0-9A-Z-]+/gi, "AGE-SECRET-KEY-…")

/** Add each identity to a fresh Decrypter. A malformed key fails with its position, never its text. */
const toDecrypter = (identities: ReadonlyArray<string>): Either<SealError, Decrypter> =>
  identities.reduce<Either<SealError, Decrypter>>(
    (acc, identity, i) =>
      acc.flatMap((decrypter) =>
        tryCatch(
          () => {
            decrypter.addIdentity(identity)
            return decrypter
          },
          () => decryptFailed(`identity ${i + 1} is not a valid age secret key`),
        ),
      ),
    Right(new Decrypter()),
  )

// ignoreBOM keeps a leading U+FEFF; typage's "text" output would strip it.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true })

/**
 * Decrypt armored age ciphertext with any of `identities` (`AGE-SECRET-KEY-…`). The plaintext is
 * returned as-is: byte for byte when it is valid UTF-8.
 */
export const decryptArmored = (
  armored: string,
  identities: ReadonlyArray<string>,
): Promise<Either<SealError, string>> => {
  if (identities.length === 0) return Promise.resolve(Left(decryptFailed("no identity provided")))
  return toDecrypter(identities).fold(
    (err) => Promise.resolve(Left<SealError, string>(err)),
    (decrypter) =>
      tryCatchAsync(
        async () => utf8.decode(await decrypter.decrypt(armor.decode(armored))),
        (err): SealError => decryptFailed(redactKeys(String(err))),
      ),
  )
}

/** Generate an X25519 age keypair: the secret identity and its public recipient. */
export const generateAgeKeypair = (): Promise<
  Either<KeygenError, { readonly identity: string; readonly recipient: string }>
> =>
  tryCatchAsync(
    async () => {
      const identity = await generateX25519Identity()
      return { identity, recipient: await identityToRecipient(identity) }
    },
    (err): KeygenError => ({ _tag: "KeygenFailed", message: `age keygen failed: ${String(err)}` }),
  )

/** The installed `age-encryption` version, for `envpkt doctor`. Its `exports` hide package.json, so read it beside the entry point. */
export const ageEncryptionVersion = (): Option<string> =>
  Try(() => {
    const entry = createRequire(import.meta.url).resolve("age-encryption")
    const pkg = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf-8")) as { version: string }
    return pkg.version
  }).toOption()

const SECRET_KEY_PREFIX = "AGE-SECRET-KEY-"

/** Classify a non-key line, so the error can name what it is without echoing its content. */
const unsupportedLine = (line: string, lineNumber: number): IdentityFileError => {
  if (line.startsWith("-----BEGIN AGE ENCRYPTED FILE-----") || line.startsWith("age-encryption.org/")) {
    return { _tag: "PassphraseProtectedIdentity" }
  }
  if (line.startsWith("AGE-PLUGIN-")) return { _tag: "UnsupportedIdentity", kind: "plugin", line: lineNumber }
  // The age CLI reads any other PEM block as an SSH key.
  if (line.startsWith("-----BEGIN") || line.startsWith("ssh-")) {
    return { _tag: "UnsupportedIdentity", kind: "ssh", line: lineNumber }
  }
  return { _tag: "UnsupportedIdentity", kind: "unknown", line: lineNumber }
}

/**
 * Read every `AGE-SECRET-KEY-…` line from an age identity file, as the `age` CLI does. Blank lines
 * and `#` comments are skipped. Any other line — a plugin or SSH key, or a passphrase-protected
 * (age-encrypted) key file — is an error, since in-process decryption can't use it.
 */
export const parseIdentityFile = (content: string): Either<IdentityFileError, ReadonlyArray<string>> => {
  const lines = content.split("\n").map((line, i) => ({ text: line.trim(), number: i + 1 }))
  const significant = lines.filter(({ text }) => text !== "" && !text.startsWith("#"))
  const firstUnsupported = significant.find(({ text }) => !text.startsWith(SECRET_KEY_PREFIX))
  if (firstUnsupported) return Left(unsupportedLine(firstUnsupported.text, firstUnsupported.number))
  if (significant.length === 0) return Left({ _tag: "NoIdentityKey" } as const)
  return Right(significant.map(({ text }) => text))
}
