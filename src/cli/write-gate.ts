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

/**
 * Validate then preview (no write) — the `--dry-run` counterpart of `writeIfValid`.
 * Runs the same structural validation the real write would, so a dry-run can never
 * show a result that the actual write would reject. On invalid output it prints the
 * same error and exits 1, exactly as the write path does.
 *
 * `display` lets callers preview a focused slice (e.g. just the new block for `add`)
 * while still validating the full resulting config.
 */
export const previewIfValid = (updated: string, display?: string): void => {
  validateOrExit(updated)
  console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
  console.log(display ?? updated)
}
