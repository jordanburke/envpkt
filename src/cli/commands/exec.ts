import { execFileSync } from "node:child_process"

import { Try } from "functype"

import { computeAudit } from "../../core/audit.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { fnoxAvailable } from "../../fnox/detect.js"
import { BOLD, exitCodeForAudit, formatAudit, formatError, RED, RESET, YELLOW } from "../output.js"

type ExecOptions = {
  readonly config?: string
  readonly profile?: string
  readonly skipAudit?: boolean
  readonly strict?: boolean
}

export const runExec = (args: ReadonlyArray<string>, options: ExecOptions): void => {
  if (args.length === 0) {
    console.error(`${RED}Error:${RESET} No command specified`)
    process.exit(2)
    return
  }

  // 1. Resolve config
  const configResult = resolveConfigPath(options.config)
  const configData = configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
      return undefined
    },
    (path) =>
      loadConfig(path).fold(
        (err) => {
          console.error(formatError(err))
          process.exit(2)
          return undefined
        },
        (config) => ({ config, path }),
      ),
  )

  if (!configData) return
  const { config, path } = configData

  // 2. Pre-flight audit (unless --skip-audit)
  if (!options.skipAudit) {
    const audit = computeAudit(config)
    console.error(`${BOLD}envpkt${RESET} pre-flight audit ${path}`)
    console.error(formatAudit(audit))
    console.error("")

    if (options.strict && audit.status !== "healthy") {
      console.error(`${RED}Aborting:${RESET} --strict mode and audit status is ${audit.status}`)
      process.exit(exitCodeForAudit(audit))
      return
    }

    if (audit.status === "critical") {
      console.error(`${YELLOW}Warning:${RESET} Proceeding despite critical audit status`)
    }
  }

  // 3. Check fnox availability
  if (!fnoxAvailable()) {
    console.error(`${YELLOW}Warning:${RESET} fnox not available — running command without secret injection`)
  }

  // 4. Build environment: current env + fnox secrets (if available)
  const env = { ...process.env }

  if (fnoxAvailable()) {
    const fnoxArgs = options.profile ? ["export", "--profile", options.profile] : ["export"]
    Try(() => execFileSync("fnox", fnoxArgs, { stdio: "pipe", encoding: "utf-8" })).fold(
      (err) => {
        console.error(`${YELLOW}Warning:${RESET} fnox export failed: ${err}`)
      },
      (output) => {
        for (const line of output.split("\n")) {
          const eq = line.indexOf("=")
          if (eq > 0) {
            const key = line.slice(0, eq).trim()
            const value = line.slice(eq + 1).trim()
            env[key] = value
          }
        }
      },
    )
  }

  // 5. Execute the command
  const [cmd, ...cmdArgs] = args
  try {
    execFileSync(cmd, cmdArgs, { env, stdio: "inherit" })
  } catch (err: unknown) {
    const exitCode = (err as { status?: number }).status ?? 1
    process.exit(exitCode)
  }
}
