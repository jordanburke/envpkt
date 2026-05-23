import { writeFileSync } from "node:fs"

import { formatValidationError, validateRawConfig } from "../core/validate.js"
import { DIM, RED, RESET } from "./output.js"

/**
 * Run structural validation against an in-memory TOML string.
 * On failure, prints the error, leaves the file untouched, and exits with code 1.
 * On success, returns — caller is responsible for writing.
 *
 * Use this when the write step has bespoke logic (e.g. wraps writeFileSync in Try,
 * has multi-line post-write output). Otherwise prefer `writeIfValid`.
 */
export const validateOrExit = (updated: string): void => {
  validateRawConfig(updated).fold(
    (err) => {
      console.error(`${RED}Error:${RESET} Aborted — change would produce an invalid config:`)
      console.error(`  ${formatValidationError(err)}`)
      console.error(`${DIM}File unchanged.${RESET}`)
      process.exit(1)
    },
    () => {},
  )
}

/**
 * Validate then persist. Most mutating CLI commands use this — it bundles the
 * validate-or-exit gate with the writeFileSync + success log so each call site
 * stays two lines instead of five.
 */
export const writeIfValid = (configPath: string, updated: string, successMsg: string): void => {
  validateOrExit(updated)
  writeFileSync(configPath, updated, "utf-8")
  console.log(successMsg)
}
