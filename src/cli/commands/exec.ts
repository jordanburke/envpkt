import { execFileSync } from "node:child_process"

import { Try } from "functype"

import { bootSafe } from "../../core/boot.js"
import { BOLD, exitCodeForAudit, formatAudit, formatConfigSource, formatError, RED, RESET, YELLOW } from "../output.js"

type ExecOptions = {
  readonly config?: string
  readonly profile?: string
  readonly skipAudit?: boolean
  readonly check?: boolean
  readonly warnOnly?: boolean
  readonly strict?: boolean
}

export const runExec = (args: ReadonlyArray<string>, options: ExecOptions): void => {
  if (args.length === 0) {
    console.error(`${RED}Error:${RESET} No command specified`)
    process.exit(2)
    return
  }

  const skipAudit = options.skipAudit ?? options.check === false

  const result = bootSafe({
    inject: false,
    configPath: options.config,
    profile: options.profile,
    failOnExpired: false,
    warnOnly: true,
  })

  const boot = result.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
      return undefined
    },
    (b) => b,
  )

  if (!boot) return

  const sourceMsg = formatConfigSource(boot.configPath, boot.configSource)
  if (sourceMsg) console.error(sourceMsg)

  // Pre-flight audit display (unless --skip-audit / --no-check)
  if (!skipAudit) {
    console.error(`${BOLD}envpkt${RESET} pre-flight audit`)
    console.error(formatAudit(boot.audit))
    console.error("")

    if (options.strict && boot.audit.status !== "healthy") {
      console.error(`${RED}Aborting:${RESET} --strict mode and audit status is ${boot.audit.status}`)
      process.exit(exitCodeForAudit(boot.audit))
      return
    }

    if (boot.audit.status === "critical" && !options.warnOnly) {
      console.error(`${RED}Aborting:${RESET} audit status is critical (use --warn-only to proceed)`)
      process.exit(exitCodeForAudit(boot.audit))
      return
    }

    if (boot.audit.status === "critical" && options.warnOnly) {
      console.error(`${YELLOW}Warning:${RESET} Proceeding despite critical audit status (--warn-only)`)
    }
  }

  boot.warnings.forEach((warning) => {
    console.error(`${YELLOW}Warning:${RESET} ${warning}`)
  })

  // Build environment: current env + env defaults + resolved secrets
  const env = { ...process.env }

  // Apply env defaults (only if key not already set)
  Object.entries(boot.envDefaults).forEach(([key, value]) => {
    if (!(key in env)) {
      env[key] = value
    }
  })

  // Apply secrets (always override)
  Object.entries(boot.secrets).forEach(([key, value]) => {
    env[key] = value
  })

  // Execute the command
  const [cmd, ...cmdArgs] = args
  Try(() => execFileSync(cmd!, cmdArgs, { env, stdio: "inherit" })).fold(
    (err) => {
      const exitCode = (err as { status?: number }).status ?? 1
      process.exit(exitCode)
    },
    () => {},
  )
}
