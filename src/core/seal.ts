import { Either, Right } from "functype"

import { decryptArmored, encryptArmored } from "./age.js"
import type { SecretMeta } from "./schema.js"
import type { SealError } from "./types.js"

/** Encrypt a plaintext string to an age recipient public key (armored output) */
export const ageEncrypt = (plaintext: string, recipient: string): Promise<Either<SealError, string>> =>
  encryptArmored(plaintext, recipient)

/**
 * Decrypt an age-armored ciphertext with any of the given secret keys (`AGE-SECRET-KEY-…`, as
 * returned by `unwrapAgentKey`). The plaintext is returned as-is, untrimmed.
 */
export const ageDecrypt = (ciphertext: string, identities: ReadonlyArray<string>): Promise<Either<SealError, string>> =>
  decryptArmored(ciphertext, identities)

/** Seal multiple secrets: encrypt each value with the recipient key and set encrypted_value on meta */
export const sealSecrets = async (
  meta: Readonly<Record<string, SecretMeta>>,
  values: Readonly<Record<string, string>>,
  recipient: string,
): Promise<Either<SealError, Record<string, SecretMeta>>> => {
  const sealed = await Either.traverseAsync(
    Object.entries(meta),
    async ([key, secretMeta]): Promise<Either<SealError, readonly [string, SecretMeta]>> => {
      const value = values[key]
      if (value === undefined) return Right([key, secretMeta] as const)

      return (await ageEncrypt(value, recipient))
        .mapLeft((err): SealError => ({ _tag: "EncryptFailed", key, message: err.message }))
        .map((ciphertext) => [key, { ...secretMeta, encrypted_value: ciphertext }] as const)
    },
  )
  return sealed.map((entries) => Object.fromEntries(entries))
}

/** Unseal secrets: decrypt encrypted_value for each meta entry that has one, with any of `identities` */
export const unsealSecrets = async (
  meta: Readonly<Record<string, SecretMeta>>,
  identities: ReadonlyArray<string>,
): Promise<Either<SealError, Record<string, string>>> => {
  const sealedEntries = Object.entries(meta).filter(
    ([, secretMeta]) => secretMeta.encrypted_value !== undefined && secretMeta.encrypted_value !== "",
  )
  const unsealed = await Either.traverseAsync(
    sealedEntries,
    async ([key, secretMeta]): Promise<Either<SealError, readonly [string, string]>> =>
      (await ageDecrypt(secretMeta.encrypted_value!, identities))
        .mapLeft((err): SealError => ({ _tag: "DecryptFailed", key, message: err.message }))
        .map((plaintext) => [key, plaintext] as const),
  )
  return unsealed.map((entries) => Object.fromEntries(entries))
}
