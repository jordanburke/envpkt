import { readFileSync, writeFileSync } from "node:fs"

import type { Command } from "commander"

import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { appendSection, removeSection, renameSection, updateSectionFields } from "../../core/toml-edit.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RED, RESET } from "../output.js"

type AddOptions = {
  readonly config?: string
  readonly service?: string
  readonly purpose?: string
  readonly comment?: string
  readonly expires?: string
  readonly capabilities?: string
  readonly rotates?: string
  readonly rateLimit?: string
  readonly modelHint?: string
  readonly source?: string
  readonly required?: boolean
  readonly rotationUrl?: string
  readonly tags?: string
  readonly dryRun?: boolean
}

type EditOptions = {
  readonly config?: string
  readonly service?: string
  readonly purpose?: string
  readonly comment?: string
  readonly expires?: string
  readonly capabilities?: string
  readonly rotates?: string
  readonly rateLimit?: string
  readonly modelHint?: string
  readonly source?: string
  readonly required?: boolean
  readonly rotationUrl?: string
  readonly tags?: string
  readonly dryRun?: boolean
}

type RmOptions = {
  readonly config?: string
  readonly dryRun?: boolean
}

type RenameOptions = {
  readonly config?: string
  readonly dryRun?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const buildSecretBlock = (name: string, options: AddOptions): string => {
  const lines: string[] = [`[secret.${name}]`]
  const today = new Date().toISOString().split("T")[0]!

  if (options.service) lines.push(`service = "${options.service}"`)
  if (options.purpose) lines.push(`purpose = "${options.purpose}"`)
  if (options.comment) lines.push(`comment = "${options.comment}"`)
  lines.push(`created = "${today}"`)
  if (options.expires) lines.push(`expires = "${options.expires}"`)
  if (options.rotates) lines.push(`rotates = "${options.rotates}"`)
  if (options.rateLimit) lines.push(`rate_limit = "${options.rateLimit}"`)
  if (options.modelHint) lines.push(`model_hint = "${options.modelHint}"`)
  if (options.source) lines.push(`source = "${options.source}"`)
  if (options.rotationUrl) lines.push(`rotation_url = "${options.rotationUrl}"`)
  if (options.required) lines.push(`required = true`)
  if (options.capabilities) {
    const caps = options.capabilities
      .split(",")
      .map((c) => `"${c.trim()}"`)
      .join(", ")
    lines.push(`capabilities = [${caps}]`)
  }
  if (options.tags) {
    const pairs = options.tags.split(",").map((pair) => {
      const [k, v] = pair.split("=").map((s) => s.trim())
      return `${k} = "${v}"`
    })
    lines.push(`tags = { ${pairs.join(", ")} }`)
  }

  return `${lines.join("\n")}\n`
}

const buildFieldUpdates = (options: EditOptions): Record<string, string | null> => {
  const updates: Record<string, string | null> = {}
  if (options.service !== undefined) updates["service"] = `"${options.service}"`
  if (options.purpose !== undefined) updates["purpose"] = `"${options.purpose}"`
  if (options.comment !== undefined) updates["comment"] = `"${options.comment}"`
  if (options.expires !== undefined) updates["expires"] = `"${options.expires}"`
  if (options.rotates !== undefined) updates["rotates"] = `"${options.rotates}"`
  if (options.rateLimit !== undefined) updates["rate_limit"] = `"${options.rateLimit}"`
  if (options.modelHint !== undefined) updates["model_hint"] = `"${options.modelHint}"`
  if (options.source !== undefined) updates["source"] = `"${options.source}"`
  if (options.rotationUrl !== undefined) updates["rotation_url"] = `"${options.rotationUrl}"`
  if (options.required !== undefined) updates["required"] = options.required ? "true" : "false"
  if (options.capabilities !== undefined) {
    const caps = options.capabilities
      .split(",")
      .map((c) => `"${c.trim()}"`)
      .join(", ")
    updates["capabilities"] = `[${caps}]`
  }
  if (options.tags !== undefined) {
    const pairs = options.tags.split(",").map((pair) => {
      const [k, v] = pair.split("=").map((s) => s.trim())
      return `${k} = "${v}"`
    })
    updates["tags"] = `{ ${pairs.join(", ")} }`
  }
  return updates
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

const runSecretAdd = (name: string, options: AddOptions): void => {
  if (options.expires && !DATE_RE.test(options.expires)) {
    console.error(`${RED}Error:${RESET} Invalid date format for --expires: "${options.expires}" (expected YYYY-MM-DD)`)
    process.exit(1)
  }

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
          if (config.secret?.[name]) {
            console.error(`${RED}Error:${RESET} Secret "${name}" already exists in ${configPath}`)
            process.exit(1)
          }

          const block = buildSecretBlock(name, options)

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

const runSecretEdit = (name: string, options: EditOptions): void => {
  if (options.expires && !DATE_RE.test(options.expires)) {
    console.error(`${RED}Error:${RESET} Invalid date format for --expires: "${options.expires}" (expected YYYY-MM-DD)`)
    process.exit(1)
  }

  withConfig(options.config, (configPath, raw) => {
    const loadResult = loadConfig(configPath)
    loadResult.fold(
      (err) => {
        console.error(formatError(err))
        process.exit(2)
      },
      (config) => {
        if (!config.secret?.[name]) {
          console.error(`${RED}Error:${RESET} Secret "${name}" not found in ${configPath}`)
          process.exit(1)
        }

        const updates = buildFieldUpdates(options)
        if (Object.keys(updates).length === 0) {
          console.error(`${RED}Error:${RESET} No fields to update. Provide at least one --flag.`)
          process.exit(1)
        }

        const result = updateSectionFields(raw, `[secret.${name}]`, updates)
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

const runSecretRm = (name: string, options: RmOptions): void => {
  withConfig(options.config, (configPath, raw) => {
    const result = removeSection(raw, `[secret.${name}]`)
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

const runSecretRename = (oldName: string, newName: string, options: RenameOptions): void => {
  withConfig(options.config, (configPath, raw) => {
    const result = renameSection(raw, `[secret.${oldName}]`, `[secret.${newName}]`)
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

const addSecretFlags = (cmd: Command): Command =>
  cmd
    .option("--service <service>", "Service this secret authenticates to")
    .option("--purpose <purpose>", "Why this secret exists")
    .option("--comment <comment>", "Free-form annotation")
    .option("--expires <date>", "Expiration date (YYYY-MM-DD)")
    .option("--capabilities <caps>", "Comma-separated capabilities (e.g. read,write)")
    .option("--rotates <schedule>", "Rotation schedule (e.g. 90d, quarterly)")
    .option("--rate-limit <limit>", "Rate limit info (e.g. 1000/min)")
    .option("--model-hint <hint>", "Suggested model or tier")
    .option("--source <source>", "Where the value originates (e.g. vault, ci)")
    .option("--rotation-url <url>", "URL for secret rotation procedure")
    .option("--tags <tags>", "Comma-separated key=value tags (e.g. env=prod,team=payments)")

export const registerSecretCommands = (program: Command): void => {
  const secret = program.command("secret").description("Manage secret entries in envpkt.toml")

  const addCmd = secret
    .command("add")
    .description("Add a new secret entry to envpkt.toml")
    .argument("<name>", "Secret name (becomes the env var key)")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--required", "Mark this secret as required")
    .option("--dry-run", "Preview the TOML block without writing")

  addSecretFlags(addCmd).action((name: string, options: AddOptions) => {
    runSecretAdd(name, options)
  })

  const editCmd = secret
    .command("edit")
    .description("Update metadata fields on an existing secret")
    .argument("<name>", "Secret name to edit")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--required", "Mark this secret as required")
    .option("--no-required", "Mark this secret as not required")
    .option("--dry-run", "Preview the changes without writing")

  addSecretFlags(editCmd).action((name: string, options: EditOptions) => {
    runSecretEdit(name, options)
  })

  secret
    .command("rm")
    .description("Remove a secret entry from envpkt.toml")
    .argument("<name>", "Secret name to remove")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--dry-run", "Preview the result without writing")
    .action((name: string, options: RmOptions) => {
      runSecretRm(name, options)
    })

  secret
    .command("rename")
    .description("Rename a secret entry, preserving all metadata")
    .argument("<old>", "Current secret name")
    .argument("<new>", "New secret name")
    .option("-c, --config <path>", "Path to envpkt.toml")
    .option("--dry-run", "Preview the result without writing")
    .action((oldName: string, newName: string, options: RenameOptions) => {
      runSecretRename(oldName, newName, options)
    })
}
