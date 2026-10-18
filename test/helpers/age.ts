import { encryptArmored, generateAgeKeypair } from "../../src/core/age.js"
import { identityFileContent } from "../../src/core/keygen.js"

/**
 * A fresh age key file's text, made in-process: the same three lines `age-keygen` prints
 * (`# created:`, `# public key: age1…`, `AGE-SECRET-KEY-…`). Specs use it so the suite needs no
 * `age` install; only the interop spec still runs the real CLI.
 */
export const ageKeygen = async (): Promise<string> =>
  (await generateAgeKeypair()).fold(
    (err) => {
      throw new Error(`test keygen failed: ${err._tag}`)
    },
    ({ identity, recipient }) => identityFileContent(identity, recipient),
  )

/** The public key (`age1…`) in key file text from `ageKeygen`. */
export const recipientOf = (keyFileText: string): string => {
  const line = keyFileText.split("\n").find((l) => l.startsWith("# public key: "))
  if (!line) throw new Error("key file text has no '# public key:' line")
  return line.slice("# public key: ".length).trim()
}

/** Seal `plaintext` to `recipient` as armored age text, like `age -r <recipient> -a`. */
export const sealTo = async (plaintext: string, recipient: string): Promise<string> =>
  (await encryptArmored(plaintext, recipient)).fold(
    (err) => {
      throw new Error(`test seal failed: ${err.message}`)
    },
    (ciphertext) => ciphertext,
  )
