import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

import { Either, Left, Right, Try } from "functype"

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

/** Unwrap an encrypted agent key using age --decrypt */
export const unwrapAgentKey = (identityPath: string): Either<IdentityError, string> => {
  if (!existsSync(identityPath)) {
    return Left({ _tag: "IdentityNotFound", path: identityPath } as const)
  }

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
}
