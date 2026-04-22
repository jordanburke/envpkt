import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

import type { Either } from "functype"
import { Left, Right, Try } from "functype"

import type { IdentityError } from "../core/types.js"

/** Check if the age CLI is available on PATH */
export const ageAvailable = (): boolean =>
  Try(() => {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  }).fold(
    () => false,
    (v) => v,
  )

/**
 * Extract the secret key from an age identity file (plain or encrypted).
 * - Plain identity files (from `age-keygen`) contain `AGE-SECRET-KEY-*` lines directly
 * - Encrypted identity files need `age --decrypt` to unwrap
 */
/* eslint-disable functype/prefer-do-notation -- two-branch fallback (plain key vs decrypt) with early-return semantics; fold makes the branching explicit */
export const unwrapAgentKey = (identityPath: string): Either<IdentityError, string> => {
  if (!existsSync(identityPath)) {
    return Left({ _tag: "IdentityNotFound", path: identityPath } as const)
  }

  return Try(() => readFileSync(identityPath, "utf-8")).fold<Either<IdentityError, string>>(
    (err) => Left({ _tag: "DecryptFailed", message: `Failed to read identity file: ${err}` } as const),
    (content) => {
      // Plain age identity file: extract the AGE-SECRET-KEY-* line directly
      const secretKeyLine = content.split("\n").find((l) => l.startsWith("AGE-SECRET-KEY-"))
      if (secretKeyLine) {
        return Right(secretKeyLine.trim())
      }

      // Encrypted identity file: decrypt with age
      if (!ageAvailable()) {
        return Left({ _tag: "AgeNotFound", message: "age CLI not found on PATH" } as const)
      }

      return Try(() =>
        execFileSync("age", ["--decrypt", identityPath], {
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf-8",
        }),
      ).fold<Either<IdentityError, string>>(
        (err) => Left({ _tag: "DecryptFailed", message: `age decrypt failed: ${err}` } as const),
        (output) => Right(output.trim()),
      )
    },
  )
}
/* eslint-enable functype/prefer-do-notation */
