import { execFileSync } from "node:child_process"

import { Either, Left, Right, Try } from "functype"

import type { FnoxError } from "../core/types.js"

/** Export all secrets from fnox as key=value pairs for a given profile */
export const fnoxExport = (profile?: string): Either<FnoxError, Record<string, string>> => {
  const args = profile ? ["export", "--profile", profile] : ["export"]

  return Try(() => execFileSync("fnox", args, { stdio: "pipe", encoding: "utf-8" })).fold<
    Either<FnoxError, Record<string, string>>
  >(
    (err) => Left({ _tag: "FnoxCliError", message: `fnox export failed: ${err}` }),
    (output) => {
      const entries: Record<string, string> = {}
      for (const line of output.split("\n")) {
        const eq = line.indexOf("=")
        if (eq > 0) {
          const key = line.slice(0, eq).trim()
          const value = line.slice(eq + 1).trim()
          entries[key] = value
        }
      }
      return Right(entries)
    },
  )
}

/** Get a single secret value from fnox */
export const fnoxGet = (key: string, profile?: string): Either<FnoxError, string> => {
  const args = profile ? ["get", key, "--profile", profile] : ["get", key]

  return Try(() => execFileSync("fnox", args, { stdio: "pipe", encoding: "utf-8" })).fold<Either<FnoxError, string>>(
    (err) => Left({ _tag: "FnoxCliError", message: `fnox get ${key} failed: ${err}` }),
    (output) => Right(output.trim()),
  )
}
