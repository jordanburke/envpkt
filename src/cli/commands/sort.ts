import { readFileSync } from "node:fs"

import { resolveConfigPath } from "../../core/config.js"
import { sortConfigToml } from "../../core/toml-edit.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RESET } from "../output.js"
import { writeIfValid } from "../write-gate.js"

type SortOptions = {
  readonly config?: string
  readonly dryRun?: boolean
}

const SECTION_HEADER_RE = /^\[(env|secret)\.(.+)\]\s*$/

const countSections = (raw: string): { env: number; secret: number } =>
  raw.split("\n").reduce(
    (acc, line) => {
      const m = SECTION_HEADER_RE.exec(line)
      if (!m) return acc
      return m[1] === "env" ? { ...acc, env: acc.env + 1 } : { ...acc, secret: acc.secret + 1 }
    },
    { env: 0, secret: 0 },
  )

export const runSort = (options: SortOptions): void => {
  const configResult = resolveConfigPath(options.config)
  configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
    },
    ({ path: configPath, source }) => {
      const sourceMsg = formatConfigSource(configPath, source)
      if (sourceMsg) console.error(sourceMsg)

      const raw = readFileSync(configPath, "utf-8")
      const sorted = sortConfigToml(raw)
      const counts = countSections(sorted)

      if (sorted === raw) {
        console.log(`${GREEN}✓${RESET} ${BOLD}Already sorted${RESET} — ${counts.env} env, ${counts.secret} secret`)
        return
      }

      if (options.dryRun) {
        console.log(`${DIM}# Preview (--dry-run):${RESET}\n`)
        console.log(sorted)
        return
      }

      writeIfValid(
        configPath,
        sorted,
        `${GREEN}✓${RESET} Sorted ${BOLD}${counts.env}${RESET} env and ${BOLD}${counts.secret}${RESET} secret entries in ${CYAN}${configPath}${RESET}`,
      )
    },
  )
}
