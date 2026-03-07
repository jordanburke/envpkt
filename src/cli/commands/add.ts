import { readFileSync, writeFileSync } from "node:fs"

import { loadConfig, resolveConfigPath } from "../../core/config.js"
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

export const runAdd = (name: string, options: AddOptions): void => {
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
          const updated = `${raw.trimEnd()}\n\n${block}`
          writeFileSync(configPath, updated, "utf-8")

          console.log(`${GREEN}✓${RESET} Added ${BOLD}${name}${RESET} to ${CYAN}${configPath}${RESET}`)
        },
      )
    },
  )
}
