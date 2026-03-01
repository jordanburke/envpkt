import { execFileSync } from "node:child_process"

import { type Either, Left, Right, Try } from "functype"

import { ageAvailable } from "../fnox/identity.js"
import type { SecretMeta } from "./schema.js"
import type { SealError } from "./types.js"

/** Encrypt a plaintext string using age with the given recipient public key (armored output) */
export const ageEncrypt = (plaintext: string, recipient: string): Either<SealError, string> => {
  if (!ageAvailable()) {
    return Left({ _tag: "AgeNotFound", message: "age CLI not found on PATH" } as const)
  }

  return Try(() =>
    execFileSync("age", ["--encrypt", "--recipient", recipient, "--armor"], {
      input: plaintext,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }),
  ).fold<Either<SealError, string>>(
    (err) => Left({ _tag: "EncryptFailed", key: "", message: `age encrypt failed: ${err}` } as const),
    (output) => Right(output.trim()),
  )
}

/** Decrypt an age-armored ciphertext using the given identity file */
export const ageDecrypt = (ciphertext: string, identityPath: string): Either<SealError, string> => {
  if (!ageAvailable()) {
    return Left({ _tag: "AgeNotFound", message: "age CLI not found on PATH" } as const)
  }

  return Try(() =>
    execFileSync("age", ["--decrypt", "--identity", identityPath], {
      input: ciphertext,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }),
  ).fold<Either<SealError, string>>(
    (err) => Left({ _tag: "DecryptFailed", key: "", message: `age decrypt failed: ${err}` } as const),
    (output) => Right(output.trim()),
  )
}

/** Seal multiple secrets: encrypt each value with the recipient key and set encrypted_value on meta */
export const sealSecrets = (
  meta: Readonly<Record<string, SecretMeta>>,
  values: Readonly<Record<string, string>>,
  recipient: string,
): Either<SealError, Record<string, SecretMeta>> => {
  if (!ageAvailable()) {
    return Left({ _tag: "AgeNotFound", message: "age CLI not found on PATH" } as const)
  }

  const result: Record<string, SecretMeta> = {}

  for (const [key, secretMeta] of Object.entries(meta)) {
    const plaintext = values[key]
    if (plaintext === undefined) {
      result[key] = secretMeta
      continue
    }

    const encrypted = ageEncrypt(plaintext, recipient)
    const outcome = encrypted.fold<Either<SealError, string>>(
      (err) => Left({ _tag: "EncryptFailed", key, message: err.message } as const),
      (ciphertext) => Right(ciphertext),
    )

    const failed = outcome.fold(
      (err) => err,
      () => undefined,
    )
    if (failed) {
      return Left(failed)
    }

    const ciphertext = outcome.fold(
      () => "",
      (v) => v,
    )
    result[key] = { ...secretMeta, encrypted_value: ciphertext }
  }

  return Right(result)
}

/** Unseal secrets: decrypt encrypted_value for each meta entry that has one */
export const unsealSecrets = (
  meta: Readonly<Record<string, SecretMeta>>,
  identityPath: string,
): Either<SealError, Record<string, string>> => {
  if (!ageAvailable()) {
    return Left({ _tag: "AgeNotFound", message: "age CLI not found on PATH" } as const)
  }

  const result: Record<string, string> = {}

  for (const [key, secretMeta] of Object.entries(meta)) {
    if (!secretMeta.encrypted_value) continue

    const decrypted = ageDecrypt(secretMeta.encrypted_value, identityPath)
    const outcome = decrypted.fold<Either<SealError, string>>(
      (err) => Left({ _tag: "DecryptFailed", key, message: err.message } as const),
      (plaintext) => Right(plaintext),
    )

    const failed = outcome.fold(
      (err) => err,
      () => undefined,
    )
    if (failed) {
      return Left(failed)
    }

    result[key] = outcome.fold(
      () => "",
      (v) => v,
    )
  }

  return Right(result)
}
