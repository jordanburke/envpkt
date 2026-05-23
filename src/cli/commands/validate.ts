import { readFileSync } from "node:fs"
import { dirname } from "node:path"

import { Try } from "functype"

import { validateAliases } from "../../core/alias.js"
import { resolveConfig } from "../../core/catalog.js"
import { parseToml, resolveConfigPath, validateConfig } from "../../core/config.js"
import type { EnvpktConfig } from "../../core/types.js"
import { formatValidationError } from "../../core/validate.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RED, RESET } from "../output.js"

type ValidateOptions = {
  readonly config?: string
  readonly json?: boolean
}

type CheckStatus = "ok" | "failed" | "skipped" | "na"

type CheckResult = {
  readonly name: string
  readonly status: CheckStatus
  readonly error?: string
  readonly detail?: string
}

type ValidationReport = {
  readonly ok: boolean
  readonly configPath: string
  readonly checks: ReadonlyArray<CheckResult>
}

const SEAL_BEGIN = "-----BEGIN AGE ENCRYPTED FILE-----"
const SEAL_END = "-----END AGE ENCRYPTED FILE-----"

const CHECK_NAMES = {
  toml: "TOML syntax",
  schema: "Schema",
  catalog: "Catalog",
  aliases: "Aliases",
  sealed: "Sealed blocks",
} as const

/** Structural sanity scan over each [secret.*].encrypted_value PEM block. No decryption. */
const checkSealedBlocks = (config: EnvpktConfig): CheckResult => {
  const secrets = config.secret ?? {}
  const sealed = Object.entries(secrets).filter(([, meta]) => typeof meta.encrypted_value === "string")

  if (sealed.length === 0) {
    return { name: CHECK_NAMES.sealed, status: "na", detail: "no sealed values" }
  }

  const broken = sealed.flatMap<string>(([key, meta]) => {
    const raw = (meta.encrypted_value ?? "").trim()
    if (!raw.startsWith(SEAL_BEGIN)) return [`[secret.${key}] encrypted_value missing BEGIN marker`]
    if (!raw.endsWith(SEAL_END)) return [`[secret.${key}] encrypted_value missing END marker`]
    return []
  })

  if (broken.length === 0) {
    return { name: CHECK_NAMES.sealed, status: "ok", detail: `${sealed.length} sealed value(s)` }
  }
  return { name: CHECK_NAMES.sealed, status: "failed", error: broken.join("; ") }
}

const skipped = (name: string): CheckResult => ({ name, status: "skipped" })

const buildReport = (path: string, raw: string): ValidationReport => {
  const parsed = parseToml(raw)
  return parsed.fold<ValidationReport>(
    (err) => ({
      ok: false,
      configPath: path,
      checks: [
        { name: CHECK_NAMES.toml, status: "failed", error: formatValidationError(err) },
        skipped(CHECK_NAMES.schema),
        skipped(CHECK_NAMES.catalog),
        skipped(CHECK_NAMES.aliases),
        skipped(CHECK_NAMES.sealed),
      ],
    }),
    (data) => {
      const tomlOk: CheckResult = { name: CHECK_NAMES.toml, status: "ok" }
      return validateConfig(data).fold<ValidationReport>(
        (err) => ({
          ok: false,
          configPath: path,
          checks: [
            tomlOk,
            { name: CHECK_NAMES.schema, status: "failed", error: formatValidationError(err) },
            skipped(CHECK_NAMES.catalog),
            skipped(CHECK_NAMES.aliases),
            skipped(CHECK_NAMES.sealed),
          ],
        }),
        (config) => {
          const schemaOk: CheckResult = { name: CHECK_NAMES.schema, status: "ok" }
          const catalogCheck: CheckResult = config.catalog
            ? resolveConfig(config, dirname(path)).fold<CheckResult>(
                (err) => ({ name: CHECK_NAMES.catalog, status: "failed", error: formatError(err) }),
                () => ({ name: CHECK_NAMES.catalog, status: "ok", detail: config.catalog }),
              )
            : { name: CHECK_NAMES.catalog, status: "na", detail: "no catalog declared" }

          const aliasCheck: CheckResult = validateAliases(config).fold<CheckResult>(
            (err) => ({ name: CHECK_NAMES.aliases, status: "failed", error: formatValidationError(err) }),
            (table) => ({
              name: CHECK_NAMES.aliases,
              status: "ok",
              detail: `${table.entries.size} alias(es)`,
            }),
          )

          const sealedCheck = checkSealedBlocks(config)

          const checks = [tomlOk, schemaOk, catalogCheck, aliasCheck, sealedCheck]
          const ok = checks.every((c) => c.status === "ok" || c.status === "na")
          return { ok, configPath: path, checks }
        },
      )
    },
  )
}

const renderCheckLines = (check: CheckResult): ReadonlyArray<string> => {
  switch (check.status) {
    case "ok": {
      const detail = check.detail ? ` ${DIM}(${check.detail})${RESET}` : ""
      return [`  ${GREEN}✓${RESET} ${check.name}${detail}`]
    }
    case "failed":
      return check.error
        ? [`  ${RED}✗${RESET} ${check.name}`, `      ${RED}${check.error}${RESET}`]
        : [`  ${RED}✗${RESET} ${check.name}`]
    case "skipped":
      return [`  ${DIM}○ ${check.name} (skipped — prior check failed)${RESET}`]
    case "na":
      return [`  ${DIM}— ${check.name} (${check.detail ?? "not applicable"})${RESET}`]
  }
}

const formatTextReport = (report: ValidationReport, sourceMsg: string): string => {
  const headerIcon = report.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
  const headerLabel = report.ok ? `${GREEN}VALID${RESET}` : `${RED}INVALID${RESET}`
  const header = `${headerIcon} ${BOLD}${headerLabel}${RESET} — ${CYAN}${report.configPath}${RESET}`
  const checkLines = report.checks.flatMap((c) => [...renderCheckLines(c)])
  const lines = [...(sourceMsg ? [sourceMsg] : []), header, "", ...checkLines]
  return lines.join("\n")
}

const formatJsonReport = (report: ValidationReport): string =>
  JSON.stringify(
    {
      ok: report.ok,
      configPath: report.configPath,
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        error: c.error ?? null,
        detail: c.detail ?? null,
      })),
    },
    null,
    2,
  )

const emit = (report: ValidationReport, sourceMsg: string, asJson: boolean): void => {
  if (asJson) {
    console.log(formatJsonReport(report))
    return
  }
  if (report.ok) {
    console.log(formatTextReport(report, sourceMsg))
  } else {
    console.error(formatTextReport(report, sourceMsg))
  }
}

export const runValidate = (options: ValidateOptions): void => {
  const configPath = resolveConfigPath(options.config)

  configPath.fold(
    (err) => {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              configPath: "path" in err ? err.path : null,
              checks: [{ name: "Config file", status: "failed", error: formatValidationError(err) }],
            },
            null,
            2,
          ),
        )
      } else {
        console.error(formatError(err))
      }
      process.exit(2)
    },
    ({ path, source }) => {
      const sourceMsg = formatConfigSource(path, source)

      Try(() => readFileSync(path, "utf-8")).fold(
        (e) => {
          const report: ValidationReport = {
            ok: false,
            configPath: path,
            checks: [{ name: "Read", status: "failed", error: (e as Error).message }],
          }
          emit(report, sourceMsg, options.json === true)
          process.exit(2)
        },
        (raw) => {
          const report = buildReport(path, raw)
          emit(report, sourceMsg, options.json === true)
          process.exit(report.ok ? 0 : 1)
        },
      )
    },
  )
}
