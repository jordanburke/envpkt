import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Either } from "functype"
import { Left, Option, Right, Try } from "functype"
import { parse } from "smol-toml"

import type { ConfigError } from "../../core/types.js"
import { BOLD, CYAN, GREEN, RED, RESET } from "../output.js"
import { validateOrExit } from "../write-gate.js"

const CONFIG_FILENAME = "envpkt.toml"

type InitOptions = {
  readonly fromFnox?: string
  readonly catalog?: string
  readonly identity?: boolean
  readonly name?: string
  readonly capabilities?: string
  readonly expires?: string
  readonly force?: boolean
  readonly scope?: string
  readonly global?: boolean
}

/** Resolve the top-level `scope` to scaffold: explicit --scope wins; --global implies "shell". */
// eslint-disable-next-line functype/prefer-option -- thin scaffold helper; undefined = omit the line
const resolveInitScope = (options: InitOptions): string | undefined =>
  options.scope ?? (options.global ? "shell" : undefined)

const todayIso = (): string => new Date().toISOString().split("T")[0]!

const generateSecretBlock = (key: string, service?: string): string => {
  const svc = service ?? key
  return `[secret.${key}]
service = "${svc}"
# purpose = ""               # Why: what this secret enables
# capabilities = []          # What operations this grants
created = "${todayIso()}"
# expires = ""               # When: YYYY-MM-DD expiration date
# rotation_url = ""          # URL for rotation procedure
# source = ""                # Where the value originates (e.g. vault, ci)
# tags = {}
`
}

const generateIdentitySection = (name: string, capabilities?: string, expires?: string): string => {
  const caps = capabilities
    ? `\ncapabilities = [${capabilities
        .split(",")
        .map((c) => `"${c.trim()}"`)
        .join(", ")}]`
    : ""
  const exp = expires ? `\nexpires = "${expires}"` : ""
  return `[identity]
name = "${name}"
# consumer = "agent"         # agent | service | developer | ci${caps}${exp}
`
}

const generateTemplate = (options: InitOptions, fnoxKeys?: ReadonlyArray<string>): string => {
  const scope = resolveInitScope(options)

  const header: ReadonlyArray<string> = [
    `#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json`,
    ``,
    `version = 1`,
    ...(scope ? [`scope = "${scope}"   # shell = secrets load ambiently on cd/eval; exec = only via envpkt exec`] : []),
    ``,
  ]

  const catalogLines: ReadonlyArray<string> = options.catalog ? [`catalog = "${options.catalog}"`, ``] : []

  const identityLines: ReadonlyArray<string> =
    options.identity && options.name
      ? [
          generateIdentitySection(options.name, options.capabilities, options.expires),
          ...(options.catalog ? [`secrets = []  # Add catalog secret keys this agent needs`] : []),
          ``,
        ]
      : []

  const secretLines: ReadonlyArray<string> =
    fnoxKeys && fnoxKeys.length > 0
      ? [`# Secrets detected from fnox.toml`, ...fnoxKeys.map((key) => generateSecretBlock(key))]
      : [
          `# Add your secret metadata below.`,
          `# Each [secret.<key>] describes a secret your agent needs.`,
          ``,
          generateSecretBlock("EXAMPLE_API_KEY", "example-service"),
        ]

  const bodyLines: ReadonlyArray<string> = !options.catalog
    ? [
        `# Lifecycle policy`,
        `[lifecycle]`,
        `stale_warning_days = 90`,
        `# require_expiration = false`,
        `# require_service = false`,
        ``,
        // Environment defaults section
        `# Plaintext environment defaults (non-secret, safe to commit)`,
        `# [env.PORT]`,
        `# value = "3000"`,
        `# purpose = "Application port"`,
        `# [env.NODE_ENV]`,
        `# value = "production"`,
        `# purpose = "Runtime environment"`,
        ``,
        ...secretLines,
      ]
    : [
        `# Optional: override catalog metadata for specific secrets`,
        `# [secret.KEY_NAME]`,
        `# capabilities = ["read"]  # narrows catalog's broader definition`,
      ]

  return [...header, ...catalogLines, ...identityLines, ...bodyLines].join("\n")
}

const readFnoxKeys = (fnoxPath: string): Either<ConfigError, ReadonlyArray<string>> =>
  Try(() => readFileSync(fnoxPath, "utf-8")).fold<Either<ConfigError, ReadonlyArray<string>>>(
    (err) => Left({ _tag: "ReadError" as const, message: String(err) } as ConfigError),
    (content) =>
      Try(() => parse(content)).fold<Either<ConfigError, ReadonlyArray<string>>>(
        (err) => Left({ _tag: "ParseError" as const, message: String(err) } as ConfigError),
        (data) => Right(Object.keys(data) as ReadonlyArray<string>),
      ),
  )

const formatConfigError = (err: ConfigError): string => {
  switch (err._tag) {
    case "FileNotFound":
      return err.path
    case "ParseError":
      return err.message
    case "ReadError":
      return err.message
    case "ValidationError":
      return err.errors.toArray().join(", ")
  }
}

export const runInit = (dir: string, options: InitOptions): void => {
  const outPath = join(dir, CONFIG_FILENAME)

  if (options.scope !== undefined && options.scope !== "shell" && options.scope !== "exec") {
    console.error(`${RED}Error:${RESET} --scope must be "shell" or "exec" (got "${options.scope}")`)
    process.exit(1)
  }

  if (existsSync(outPath) && !options.force) {
    console.error(`${RED}Error:${RESET} ${CONFIG_FILENAME} already exists. Use --force to overwrite.`)
    process.exit(1)
  }

  const fnoxKeys: Option<ReadonlyArray<string>> = Option(options.fromFnox).map((fromFnox) => {
    const fnoxPath = fromFnox === "true" || fromFnox === "" ? join(dir, "fnox.toml") : fromFnox

    if (!existsSync(fnoxPath)) {
      console.error(`${RED}Error:${RESET} fnox.toml not found at ${fnoxPath}`)
      process.exit(1)
    }

    return readFnoxKeys(fnoxPath).fold(
      (err) => {
        console.error(`${RED}Error:${RESET} Failed to read fnox.toml: ${formatConfigError(err)}`)
        process.exit(1)
        return [] as ReadonlyArray<string> // unreachable
      },
      (keys) => keys,
    )
  })

  const content = generateTemplate(options, fnoxKeys.orUndefined())

  validateOrExit(content)
  const writeResult = Try(() => writeFileSync(outPath, content, "utf-8"))
  writeResult.fold(
    (err) => {
      console.error(`${RED}Error:${RESET} Failed to write ${CONFIG_FILENAME}: ${err}`)
      process.exit(1)
    },
    () => {
      console.log(`${GREEN}✓${RESET} Created ${BOLD}${CONFIG_FILENAME}${RESET} in ${CYAN}${dir}${RESET}`)
      fnoxKeys.forEach((keys) => {
        console.log(`  Scaffolded ${keys.length} secret(s) from fnox.toml`)
      })
      console.log(`  ${BOLD}Next:${RESET} Fill in metadata for each secret`)
    },
  )
}
