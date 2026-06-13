import { bootSafe } from "../../core/boot.js"
import { resolveConfigPath } from "../../core/config.js"
import type { BootError } from "../../core/types.js"
import { ageInstallHint, ageVersion } from "../../fnox/identity.js"
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "../output.js"

type DoctorOptions = {
  readonly config?: string
}

const ok = (label: string, detail: string): void => console.log(`  ${GREEN}✓${RESET} ${label}  ${DIM}${detail}${RESET}`)
const warn = (label: string, detail: string): void => console.log(`  ${YELLOW}—${RESET} ${label}  ${detail}`)
const bad = (label: string, detail: string): void => console.log(`  ${RED}✗${RESET} ${label}  ${detail}`)

/** Print the resolution/key check, returning whether it passed. */
const reportResolution = (configPath: string): boolean =>
  bootSafe({ configPath, inject: false, warnOnly: true }).fold(
    (err: BootError) => {
      if (err._tag === "SealKeyUnavailable") {
        bad("key   ", `${err.sealedKeys.length} sealed secret(s) but no decryption key`)
        err.searched.forEach((line) => console.log(`${DIM}        ${line}${RESET}`))
      } else {
        bad("config", `${err._tag}`)
      }
      return false
    },
    (boot) => {
      const resolved = Object.keys(boot.secrets).length
      ok("secrets", `${resolved} resolved, ${boot.skipped.length} skipped`)
      const auditColor = boot.audit.status === "healthy" ? GREEN : YELLOW
      console.log(`  ${auditColor}•${RESET} audit   ${DIM}${boot.audit.status}${RESET}`)
      return true
    },
  )

/**
 * One-shot environment check: is age installed, is a config resolvable, and do its sealed
 * secrets decrypt with an available key? Read-only; exits non-zero if any check fails.
 */
export const runDoctor = (options: DoctorOptions): void => {
  console.log(`${BOLD}envpkt doctor${RESET}\n`)

  const ageOk = ageVersion().fold(
    () => {
      bad("age   ", "not found on PATH")
      console.log(`${DIM}        ${ageInstallHint().split("\n").join("\n        ")}${RESET}`)
      return false
    },
    (version) => {
      ok("age   ", version)
      return true
    },
  )

  const resolveOk = resolveConfigPath(options.config).fold(
    () => {
      warn("config", "no envpkt.toml found for this directory")
      return true // not an error — envpkt works without a config present
    },
    ({ path }) => {
      ok("config", path)
      return reportResolution(path)
    },
  )

  console.log("")
  if (ageOk && resolveOk) {
    console.log(`${GREEN}✓ no issues${RESET}`)
  } else {
    console.log(
      `${RED}✗ ${[!ageOk, !resolveOk].filter(Boolean).length} issue(s) found${RESET} ${CYAN}(see above)${RESET}`,
    )
    process.exit(1)
  }
}
