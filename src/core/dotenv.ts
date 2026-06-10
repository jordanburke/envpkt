/**
 * Serialize resolved credential entries to `.env` (dotenv) format.
 *
 * Unlike `env export` (shell `export VAR=...` for `eval`) this emits the bare
 * `KEY=value` syntax that the broad `.env`-consuming ecosystem auto-discovers:
 * Wrangler, Docker `--env-file`, Vite/Next/Astro, many GitHub Actions, direnv.
 *
 * Pure and deterministic — no I/O, no timestamps — so regenerating a file
 * produces identical output (clean diffs, reproducible CI).
 */

export type DotenvEntry = {
  readonly name: string
  readonly value: string
  readonly secret: boolean
}

export type FormatDotenvOptions = {
  /** Write secret values into the output. Default true (matches `env export`/`env github`). */
  readonly includeSecrets?: boolean
  /** A pre-formatted comment block (each line `#`-prefixed) placed at the top. */
  readonly header?: string
}

// Values made only of these characters are safe to emit unquoted in both dotenv
// parsers and shell sourcing. Anything else (spaces, quotes, $, #, backticks,
// newlines, ...) is double-quoted and escaped.
const BARE_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
 * Quote a single value for dotenv output. Returns the value bare when safe,
 * otherwise double-quoted with POSIX-shell-quote escaping (`\`, `"`, `$`) and
 * whitespace collapsed to single-line escapes (`\n`, `\r`, `\t`) for portability.
 */
export const quoteDotenvValue = (value: string): string => {
  if (value === "") return ""
  if (BARE_SAFE.test(value)) return value

  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")

  return `"${escaped}"`
}

const formatEntry = (entry: DotenvEntry, includeSecrets: boolean): string => {
  if (entry.secret && !includeSecrets) {
    return `# (secret value omitted — re-run without --no-secrets to include)\n${entry.name}=`
  }
  return `${entry.name}=${quoteDotenvValue(entry.value)}`
}

/** Serialize entries to dotenv text (no trailing newline). */
export const formatDotenv = (entries: ReadonlyArray<DotenvEntry>, options?: FormatDotenvOptions): string => {
  const includeSecrets = options?.includeSecrets ?? true
  const body = entries.map((e) => formatEntry(e, includeSecrets)).join("\n")
  const header = options?.header
  return header ? `${header}\n\n${body}` : body
}
