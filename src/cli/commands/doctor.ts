import { ageEncryptionVersion } from "../../core/age.js"
import { bootSafe } from "../../core/boot.js"
import { resolveConfigPath } from "../../core/config.js"
import type { BootError } from "../../core/types.js"
import { describeIdentityError, isIdentityError } from "../../fnox/identity.js"
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "../output.js"

type DoctorOptions = {
  readonly config?: string
}

const ok = (label: string, detail: string): void => console.log(`  ${GREEN}✓${RESET} ${label}  ${DIM}${detail}${RESET}`)
const warn = (label: string, detail: string): void => console.log(`  ${YELLOW}—${RESET} ${label}  ${detail}`)
const bad = (label: string, detail: string): void => console.log(`  ${RED}✗${RESET} ${label}  ${detail}`)

/** Print the resolution/key check, returning whether it passed. */
const reportResolution = async (configPath: string): Promise<boolean> =>
  (await bootSafe({ configPath, inject: false, warnOnly: true })).fold(
    (err: BootError) => {
      if (err._tag === "SealKeyUnavailable") {
        bad("key   ", `${err.sealedKeys.length} sealed secret(s) but no decryption key`)
        err.searched.forEach((line) => console.log(`${DIM}        ${line}${RESET}`))
      } else if (isIdentityError(err)) {
        bad("key   ", describeIdentityError(err))
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
 * One-shot environment check: is a config resolvable, and do its sealed secrets decrypt with an
 * available key? Also reports the built-in age version. Read-only; exits non-zero if a check fails.
 */
export const runDoctor = async (options: DoctorOptions): Promise<void> => {
  console.log(`${BOLD}envpkt doctor${RESET}\n`)

  // age is built in (age-encryption), so there is nothing to install; report which version.
  ok("age   ", `built in (age-encryption ${ageEncryptionVersion().orElse("version unknown")})`)

  const resolveOk = await resolveConfigPath(options.config).fold(
    () => {
      warn("config", "no envpkt.toml found for this directory")
      return Promise.resolve(true) // not an error — envpkt works without a config present
    },
    ({ path }) => {
      ok("config", path)
      return reportResolution(path)
    },
  )

  console.log("")
  if (resolveOk) {
    console.log(`${GREEN}✓ no issues${RESET}`)
  } else {
    console.log(`${RED}✗ issue found${RESET} ${CYAN}(see above)${RESET}`)
    process.exit(1)
  }
}
