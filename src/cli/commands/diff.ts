import { loadConfig } from "../../core/config.js"
import { diffConfigs, type SectionDiff } from "../../core/diff.js"
import type { EnvpktConfig } from "../../core/types.js"
import { BOLD, DIM, formatError, GREEN, RED, RESET, YELLOW } from "../output.js"

type DiffOptions = {
  readonly format?: string
  readonly exitCode?: boolean
}

const formatSection = (name: string, s: SectionDiff): ReadonlyArray<string> => {
  if (s.onlyA.length === 0 && s.onlyB.length === 0 && s.changed.length === 0) return []
  return [
    `${BOLD}[${name}]${RESET}`,
    ...s.onlyA.map((k) => `  ${RED}- ${k}${RESET}`),
    ...s.onlyB.map((k) => `  ${GREEN}+ ${k}${RESET}`),
    ...s.changed.flatMap((c) => [
      `  ${YELLOW}~ ${c.key}${RESET}`,
      ...c.changes.map((ch) => `      ${ch.field}: ${DIM}${ch.a ?? "∅"}${RESET} → ${DIM}${ch.b ?? "∅"}${RESET}`),
    ]),
  ]
}

const loadOrExit = (path: string, side: string): EnvpktConfig =>
  loadConfig(path).fold(
    (err) => {
      console.error(`${RED}Error${RESET} (${side} = ${path}): ${formatError(err)}`)
      process.exit(2)
      return undefined! // unreachable
    },
    (config) => config,
  )

/**
 * Compare two envpkt.toml files by their `[secret.*]` and `[env.*]` entries. Reports keys only in
 * each side and field-level metadata changes for shared keys (ciphertext is ignored; sealed-status
 * changes are reported). With `--exit-code`, exits non-zero when the configs differ.
 */
export const runDiff = (pathA: string, pathB: string, options: DiffOptions): void => {
  const diff = diffConfigs(loadOrExit(pathA, "a"), loadOrExit(pathB, "b"))

  if (options.format === "json") {
    console.log(JSON.stringify(diff, null, 2))
  } else if (diff.identical) {
    console.log(`${GREEN}✓${RESET} no differences`)
  } else {
    const body = [...formatSection("secret", diff.secret), ...formatSection("env", diff.env)]
    console.log(`${DIM}- ${pathA}\n+ ${pathB}${RESET}\n\n${body.join("\n")}`)
  }

  if (options.exitCode && !diff.identical) {
    process.exit(1)
  }
}
