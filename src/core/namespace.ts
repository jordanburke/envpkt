import type { EnvpktConfig } from "./types.js"

const DEFAULT_SEPARATOR = "__"

const SHELL_SAFE_SEPARATOR_RE = /^[A-Za-z0-9_]+$/

/**
 * A separator is shell-safe when the resulting wire name is still a valid POSIX
 * shell identifier. Only `[A-Za-z0-9_]` qualify — `.` and `:` (and empties)
 * break `export NAME=` / `$NAME` and must be flagged.
 */
export const isShellSafeSeparator = (separator: string): boolean => SHELL_SAFE_SEPARATOR_RE.test(separator)

/**
 * Build the logical-key → wire-name transform for a config.
 *
 * The wire name is what gets written to / read from `process.env`. It is the
 * only place a namespace prefix is applied — internal records (audit, aliases,
 * fnox lookup) stay keyed by the canonical logical name.
 *
 * A per-entry namespace overrides the file-level prefix; an explicit empty
 * string opts out (`"" ?? filePrefix` → `""`, a falsy prefix = no prefix).
 *
 * The default separator is `__` because it is the only namespace separator
 * valid in a POSIX shell identifier (`.`/`:` break shell `export`/`$VAR`).
 */
export const makeEnvNamer = (config: EnvpktConfig): ((logicalKey: string, entryNamespace?: string) => string) => {
  const filePrefix = config.namespace?.prefix
  const separator = config.namespace?.separator ?? DEFAULT_SEPARATOR
  return (logicalKey, entryNamespace) => {
    const prefix = entryNamespace ?? filePrefix
    return prefix ? `${prefix}${separator}${logicalKey}` : logicalKey
  }
}

/**
 * Dotted display form (e.g. `CIV.API_KEY`) for human/agent-facing output —
 * format, MCP, and audit. Never use this for injection; the wire name uses the
 * shell-safe separator instead.
 */
export const displayName = (config: EnvpktConfig, logicalKey: string, entryNamespace?: string): string => {
  const prefix = entryNamespace ?? config.namespace?.prefix
  return prefix ? `${prefix}.${logicalKey}` : logicalKey
}
