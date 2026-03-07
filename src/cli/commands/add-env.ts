import { readFileSync, writeFileSync } from "node:fs"

import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RED, RESET } from "../output.js"

type AddEnvOptions = {
  readonly config?: string
  readonly purpose?: string
  readonly comment?: string
  readonly tags?: string
  readonly dryRun?: boolean
}

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

export const runAddEnv = (name: string, value: string, options: AddEnvOptions): void => {
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
          const updated = `${raw.trimEnd()}\n\n${block}`
          writeFileSync(configPath, updated, "utf-8")

          console.log(`${GREEN}✓${RESET} Added ${BOLD}${name}${RESET} to ${CYAN}${configPath}${RESET}`)
        },
      )
    },
  )
}
