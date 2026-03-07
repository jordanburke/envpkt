import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import type { Command } from "commander"
import { Try } from "functype"

import { bootSafe } from "../../core/boot.js"
import { resolveConfig } from "../../core/catalog.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { envCheck, envScan, generateTomlFromScan } from "../../core/env.js"
import { appendSection, removeSection, renameSection, updateSectionFields } from "../../core/toml-edit.js"
import {
  BOLD,
  CYAN,
  DIM,
  formatCheckJson,
  formatCheckTable,
  formatConfigSource,
  formatError,
  formatScanJson,
  formatScanTable,
  GREEN,
  RED,
  RESET,
  YELLOW,
} from "../output.js"

type ScanOptions = {
  readonly config?: string
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

type ExportOptions = {
  readonly config?: string
  readonly profile?: string
  readonly skipAudit?: boolean
}

type AddEnvOptions = {
  readonly config?: string
  readonly purpose?: string
  readonly comment?: string
  readonly tags?: string
  readonly dryRun?: boolean
}

type EditEnvOptions = {
  readonly config?: string
  readonly value?: string
  readonly purpose?: string
  readonly comment?: string
  readonly tags?: string
  readonly dryRun?: boolean
}

type RmEnvOptions = {
  readonly config?: string
  readonly dryRun?: boolean
}

type RenameEnvOptions = {
  readonly config?: string
  readonly dryRun?: boolean
}

const printPostWriteGuidance = (): void => {
  console.log(`\n${DIM}Note: Secret values are NOT stored — only metadata.${RESET}`)
  console.log(`${BOLD}Next steps:${RESET}`)
  console.log(`  ${DIM}1.${RESET} envpkt keygen          ${DIM}# generate age key (if no recipient configured)${RESET}`)
  console.log(`  ${DIM}2.${RESET} envpkt seal            ${DIM}# encrypt secret values into envpkt.toml${RESET}`)
}

const runEnvScan = (options: ScanOptions): void => {
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

    const configPath = resolve(options.config ?? join(process.cwd(), "envpkt.toml"))
    if (existsSync(configPath)) {
      // Append only new entries not already in the file
      const existing = Try(() => readFileSync(configPath, "utf-8")).fold(
        () => "",
        (c) => c,
      )

      const newEntries = scan.discovered.toArray().filter((m) => !existing.includes(`[secret.${m.envVar}]`))

      if (newEntries.length === 0) {
        console.log(`\n${GREEN}✓${RESET} All discovered credentials already tracked in ${CYAN}${configPath}${RESET}`)
        return
      }

      const newToml = generateTomlFromScan(newEntries)
      const writeResult = Try(() => writeFileSync(configPath, `${existing.trimEnd()}\n\n${newToml}`, "utf-8"))
      writeResult.fold(
        (err) => {
          console.error(`\n${RED}Error:${RESET} Failed to write: ${err}`)
          process.exit(1)
        },
        () => {
          console.log(
            `\n${GREEN}✓${RESET} Appended ${BOLD}${newEntries.length}${RESET} new entry/entries to ${CYAN}${configPath}${RESET}`,
          )
          printPostWriteGuidance()
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
            `\n${GREEN}✓${RESET} Created ${CYAN}${configPath}${RESET} with ${BOLD}${scan.discovered.size}${RESET} credential(s)`,
          )
          printPostWriteGuidance()
        },
      )
    }
  }
}

const runEnvCheck = (options: CheckOptions): void => {
  const configPath = resolveConfigPath(options.config)

  configPath.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    ({ path, source }) => {
      const sourceMsg = formatConfigSource(path, source)
      if (sourceMsg) console.error(sourceMsg)
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

const shellEscape = (value: string): string => value.replace(/'/g, "'\\''")

const runEnvExport = (options: ExportOptions): void => {
  const result = bootSafe({
    inject: false,
    configPath: options.config,
    profile: options.profile,
    warnOnly: true,
  })

  result.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    (boot) => {
      const sourceMsg = formatConfigSource(boot.configPath, boot.configSource)
      if (sourceMsg) console.error(sourceMsg)

      for (const warning of boot.warnings) {
        console.error(`${YELLOW}Warning:${RESET} ${warning}`)
      }

      for (const [key, value] of Object.entries(boot.envDefaults)) {
        console.log(`export ${key}='${shellEscape(value)}'`)
      }

      for (const [key, value] of Object.entries(boot.secrets)) {
        console.log(`export ${key}='${shellEscape(value)}'`)
      }
    },
  )
}

// --- CRUD operations ---

const buildEnvBlock = (name: string, value: string, options: AddEnvOptions): string => {
  const lines: string[] = [`[env.${name}]`, `value = "${value}"`]

  if (options.purpose) lines.push(`purpose = "${options.purpose}"`)
  if (options.comment) lines.push(`comment = "${options.comment}"`)
  if (options.tags) {
    const pairs = options.tags.split(",").map((pair) => {
      const [k, v] = pair.split("=").map((s) => s.trim())
      return `${k} = "${v}"`
    })
    lines.push(`tags = { ${pairs.join(", ")} }`)
  }

  return `${lines.join("\n")}\n`
}

const withConfig = (configFlag: string | undefined, fn: (configPath: string, raw: string) => void): void => {
  const configResult = resolveConfigPath(configFlag)
  configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    ({ path: configPath, source }) => {
      const sourceMsg = formatConfigSource(configPath, source)
      if (sourceMsg) console.error(sourceMsg)
      const raw = readFileSync(configPath, "utf-8")
      fn(configPath, raw)
    },
  )
}

const runEnvAdd = (name: string, value: string, options: AddEnvOptions): void => {
  const configResult = resolveConfigPath(options.config)

  configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    ({ path: configPath, source }) => {
      const sourceMsg = formatConfigSource(configPath, source)
      if (sourceMsg) console.error(sourceMsg)

      const loadResult = loadConfig(configPath)

      loadResult.fold(
        (err) => {
          console.error(formatError(err))
          process.exit(2)
        },
        (config) => {
          if (config.env?.[name]) {
            console.error(`${RED}Error:${RESET} Env entry "${name}" already exists in ${configPath}`)
            process.exit(1)
          }

          const block = buildEnvBlock(name, value, options)

          if (options.dryRun) {
            console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
            console.log(block)
            return
          }

          const raw = readFileSync(configPath, "utf-8")
          const updated = appendSection(raw, block)
          writeFileSync(configPath, updated, "utf-8")

          console.log(`${GREEN}✓${RESET} Added ${BOLD}${name}${RESET} to ${CYAN}${configPath}${RESET}`)
        },
      )
    },
  )
}

const runEnvEdit = (name: string, options: EditEnvOptions): void => {
  withConfig(options.config, (configPath, raw) => {
    const loadResult = loadConfig(configPath)
    loadResult.fold(
      (err) => {
        console.error(formatError(err))
        process.exit(2)
      },
      (config) => {
        if (!config.env?.[name]) {
          console.error(`${RED}Error:${RESET} Env entry "${name}" not found in ${configPath}`)
          process.exit(1)
        }

        const updates: Record<string, string | null> = {}
        if (options.value !== undefined) updates["value"] = `"${options.value}"`
        if (options.purpose !== undefined) updates["purpose"] = `"${options.purpose}"`
        if (options.comment !== undefined) updates["comment"] = `"${options.comment}"`
        if (options.tags !== undefined) {
          const pairs = options.tags.split(",").map((pair) => {
            const [k, v] = pair.split("=").map((s) => s.trim())
            return `${k} = "${v}"`
          })
          updates["tags"] = `{ ${pairs.join(", ")} }`
        }

        if (Object.keys(updates).length === 0) {
          console.error(`${RED}Error:${RESET} No fields to update. Provide at least one --flag.`)
          process.exit(1)
        }

        const result = updateSectionFields(raw, `[env.${name}]`, updates)
        result.fold(
          (err) => {
            console.error(`${RED}Error:${RESET} ${err._tag}: ${err.section}`)
            process.exit(2)
          },
          (updated) => {
            if (options.dryRun) {
              console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
              console.log(updated)
              return
            }
            writeFileSync(configPath, updated, "utf-8")
            console.log(`${GREEN}✓${RESET} Updated ${BOLD}${name}${RESET} in ${CYAN}${configPath}${RESET}`)
          },
        )
      },
    )
  })
}

const runEnvRm = (name: string, options: RmEnvOptions): void => {
  withConfig(options.config, (configPath, raw) => {
    const result = removeSection(raw, `[env.${name}]`)
    result.fold(
      (err) => {
        console.error(`${RED}Error:${RESET} ${err._tag}: ${err.section}`)
        process.exit(1)
      },
      (updated) => {
        if (options.dryRun) {
          console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
          console.log(updated)
          return
        }
        writeFileSync(configPath, updated, "utf-8")
        console.log(`${GREEN}✓${RESET} Removed ${BOLD}${name}${RESET} from ${CYAN}${configPath}${RESET}`)
      },
    )
  })
}

const runEnvRename = (oldName: string, newName: string, options: RenameEnvOptions): void => {
  withConfig(options.config, (configPath, raw) => {
    const result = renameSection(raw, `[env.${oldName}]`, `[env.${newName}]`)
    result.fold(
      (err) => {
        console.error(`${RED}Error:${RESET} ${err._tag}: ${err.section}`)
        process.exit(1)
      },
      (updated) => {
        if (options.dryRun) {
          console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
          console.log(updated)
          return
        }
        writeFileSync(configPath, updated, "utf-8")
        console.log(
          `${GREEN}✓${RESET} Renamed ${BOLD}${oldName}${RESET} → ${BOLD}${newName}${RESET} in ${CYAN}${configPath}${RESET}`,
        )
      },
    )
  })
}

export const registerEnvCommands = (program: Command): void => {
  const env = program.command("env").description("Manage environment defaults and discover credentials")

  env
    .command("scan")
    .description(
      "Auto-discover credentials from process.env and scaffold TOML entries — first step in the developer workflow",
    )
    .option("-c, --config <path>", "Path to envpkt.toml (write target for --write)")
    .option("--format <format>", "Output format: table | json", "table")
    .option("--write", "Write discovered credentials to envpkt.toml")
    .option("--dry-run", "Preview TOML that would be written (implies --write)")
    .option("--include-unknown", "Include vars where service could not be inferred")
    .action((options: ScanOptions) => {
      runEnvScan(options)
    })

  env
    .command("check")
    .description("Bidirectional drift detection between envpkt.toml and live environment")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--format <format>", "Output format: table | json", "table")
    .option("--strict", "Exit non-zero on any drift")
    .action((options: CheckOptions) => {
      runEnvCheck(options)
    })

  env
    .command("export")
    .description(
      'Output export statements for eval-ing secrets into the current shell. Usage: eval "$(envpkt env export)"',
    )
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--profile <profile>", "fnox profile to use")
    .option("--skip-audit", "Skip the pre-flight audit")
    .action((options: ExportOptions) => {
      runEnvExport(options)
    })

  env
    .command("add")
    .description("Add a new environment default entry to envpkt.toml")
    .argument("<name>", "Environment variable name")
    .argument("<value>", "Default value")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--purpose <purpose>", "Why this env var exists")
    .option("--comment <comment>", "Free-form annotation")
    .option("--tags <tags>", "Comma-separated key=value tags (e.g. env=prod,team=payments)")
    .option("--dry-run", "Preview the TOML block without writing")
    .action((name: string, value: string, options: AddEnvOptions) => {
      runEnvAdd(name, value, options)
    })

  env
    .command("edit")
    .description("Update fields on an existing env entry")
    .argument("<name>", "Environment variable name to edit")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--value <value>", "New default value")
    .option("--purpose <purpose>", "Why this env var exists")
    .option("--comment <comment>", "Free-form annotation")
    .option("--tags <tags>", "Comma-separated key=value tags (e.g. env=prod,team=payments)")
    .option("--dry-run", "Preview the changes without writing")
    .action((name: string, options: EditEnvOptions) => {
      runEnvEdit(name, options)
    })

  env
    .command("rm")
    .description("Remove an env entry from envpkt.toml")
    .argument("<name>", "Environment variable name to remove")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--dry-run", "Preview the result without writing")
    .action((name: string, options: RmEnvOptions) => {
      runEnvRm(name, options)
    })

  env
    .command("rename")
    .description("Rename an env entry, preserving all fields")
    .argument("<old>", "Current env variable name")
    .argument("<new>", "New env variable name")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--dry-run", "Preview the result without writing")
    .action((oldName: string, newName: string, options: RenameEnvOptions) => {
      runEnvRename(oldName, newName, options)
    })
}
