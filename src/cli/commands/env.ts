import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { Try } from "functype"

import { resolveConfig } from "../../core/catalog.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { envCheck, envScan, generateTomlFromScan } from "../../core/env.js"
import {
  BOLD,
  CYAN,
  DIM,
  formatCheckJson,
  formatCheckTable,
  formatError,
  formatScanJson,
  formatScanTable,
  GREEN,
  RED,
  RESET,
} from "../output.js"

type ScanOptions = {
  readonly format?: string
  readonly write?: boolean
  readonly dryRun?: boolean
  readonly includeUnknown?: boolean
}

type CheckOptions = {
  readonly config?: string
  readonly format?: string
  readonly strict?: boolean
}

export const runEnvScan = (options: ScanOptions): void => {
  const scan = envScan(process.env, { includeUnknown: options.includeUnknown })

  if (scan.discovered.size === 0) {
    console.log(`${DIM}No credentials detected in environment.${RESET}`)
    process.exit(0)
  }

  if (options.format === "json") {
    console.log(formatScanJson(scan))
  } else {
    console.log(formatScanTable(scan))
  }

  if (options.write || options.dryRun) {
    const toml = generateTomlFromScan(scan.discovered.toArray())

    if (options.dryRun) {
      console.log(`\n${BOLD}Preview (--dry-run):${RESET}\n`)
      console.log(toml)
      return
    }

    const configPath = join(process.cwd(), "envpkt.toml")
    if (existsSync(configPath)) {
      // Append only new entries not already in the file
      const existing = Try(() => readFileSync(configPath, "utf-8")).fold(
        () => "",
        (c) => c,
      )

      const newEntries = scan.discovered.toArray().filter((m) => !existing.includes(`[meta.${m.envVar}]`))

      if (newEntries.length === 0) {
        console.log(`\n${GREEN}✓${RESET} All discovered credentials already tracked in envpkt.toml`)
        return
      }

      const newToml = generateTomlFromScan(newEntries)
      const writeResult = Try(() => writeFileSync(configPath, existing.trimEnd() + "\n\n" + newToml, "utf-8"))
      writeResult.fold(
        (err) => {
          console.error(`\n${RED}Error:${RESET} Failed to write: ${err}`)
          process.exit(1)
        },
        () => {
          console.log(
            `\n${GREEN}✓${RESET} Appended ${BOLD}${newEntries.length}${RESET} new entry/entries to ${CYAN}${configPath}${RESET}`,
          )
        },
      )
    } else {
      // Create new file with header
      const header = `#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json\n\nversion = 1\n\n[lifecycle]\nstale_warning_days = 90\n\n`
      const writeResult = Try(() => writeFileSync(configPath, header + toml, "utf-8"))
      writeResult.fold(
        (err) => {
          console.error(`\n${RED}Error:${RESET} Failed to write: ${err}`)
          process.exit(1)
        },
        () => {
          console.log(
            `\n${GREEN}✓${RESET} Created ${BOLD}envpkt.toml${RESET} with ${CYAN}${scan.discovered.size}${RESET} credential(s)`,
          )
        },
      )
    }
  }
}

export const runEnvCheck = (options: CheckOptions): void => {
  const configPath = resolveConfigPath(options.config)

  configPath.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    (path) => {
      const result = loadConfig(path)

      result.fold(
        (err) => {
          console.error(formatError(err))
          process.exit(2)
        },
        (rawConfig) => {
          const configDir = dirname(path)
          const resolved = resolveConfig(rawConfig, configDir)

          resolved.fold(
            (err) => {
              console.error(formatError(err))
              process.exit(2)
            },
            (resolveResult) => {
              const check = envCheck(resolveResult.config, process.env)

              if (options.format === "json") {
                console.log(formatCheckJson(check))
              } else {
                console.log(formatCheckTable(check))
              }

              if (options.strict && !check.is_clean) {
                process.exit(1)
              }
            },
          )
        },
      )
    },
  )
}
