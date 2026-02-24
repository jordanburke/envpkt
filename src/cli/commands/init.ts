import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Either } from "functype"
import { Left, Right, Try } from "functype"
import { parse } from "smol-toml"

import type { ConfigError } from "../../core/types.js"
import { BOLD, CYAN, GREEN, RED, RESET } from "../output.js"

const CONFIG_FILENAME = "envpkt.toml"

type InitOptions = {
  readonly fromFnox?: string
  readonly agent?: boolean
  readonly name?: string
  readonly capabilities?: string
  readonly expires?: string
  readonly force?: boolean
}

const todayIso = (): string => new Date().toISOString().split("T")[0]!

const generateSecretBlock = (key: string, service?: string): string => {
  const svc = service ?? key
  return `[meta.${key}]
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

const generateAgentSection = (name: string, capabilities?: string, expires?: string): string => {
  const caps = capabilities
    ? `\ncapabilities = [${capabilities
        .split(",")
        .map((c) => `"${c.trim()}"`)
        .join(", ")}]`
    : ""
  const exp = expires ? `\nexpires = "${expires}"` : ""
  return `[agent]
name = "${name}"
# consumer = "agent"         # agent | service | developer | ci${caps}${exp}
`
}

const generateTemplate = (options: InitOptions, fnoxKeys?: ReadonlyArray<string>): string => {
  const lines: string[] = []

  lines.push(`#:schema https://raw.githubusercontent.com/jordanburke/envpkt/main/schemas/envpkt.schema.json`)
  lines.push(``)
  lines.push(`version = 1`)
  lines.push(``)

  if (options.agent && options.name) {
    lines.push(generateAgentSection(options.name, options.capabilities, options.expires))
    lines.push(``)
  }

  lines.push(`# Lifecycle policy`)
  lines.push(`[lifecycle]`)
  lines.push(`stale_warning_days = 90`)
  lines.push(`# require_expiration = false`)
  lines.push(`# require_service = false`)
  lines.push(``)

  if (fnoxKeys && fnoxKeys.length > 0) {
    lines.push(`# Secrets detected from fnox.toml`)
    for (const key of fnoxKeys) {
      lines.push(generateSecretBlock(key))
    }
  } else {
    lines.push(`# Add your secret metadata below.`)
    lines.push(`# Each [meta.<key>] describes a secret your agent needs.`)
    lines.push(``)
    lines.push(generateSecretBlock("EXAMPLE_API_KEY", "example-service"))
  }

  return lines.join("\n")
}

const readFnoxKeys = (fnoxPath: string): Either<ConfigError, ReadonlyArray<string>> =>
  Try(() => readFileSync(fnoxPath, "utf-8")).fold<Either<ConfigError, ReadonlyArray<string>>>(
    (err) => Left({ _tag: "ReadError" as const, message: String(err) }),
    (content) =>
      Try(() => parse(content)).fold<Either<ConfigError, ReadonlyArray<string>>>(
        (err) => Left({ _tag: "ParseError" as const, message: String(err) }),
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

  if (existsSync(outPath) && !options.force) {
    console.error(`${RED}Error:${RESET} ${CONFIG_FILENAME} already exists. Use --force to overwrite.`)
    process.exit(1)
  }

  let fnoxKeys: ReadonlyArray<string> | undefined

  if (options.fromFnox) {
    const fnoxPath = options.fromFnox === "true" || options.fromFnox === "" ? join(dir, "fnox.toml") : options.fromFnox

    if (!existsSync(fnoxPath)) {
      console.error(`${RED}Error:${RESET} fnox.toml not found at ${fnoxPath}`)
      process.exit(1)
    }

    const result = readFnoxKeys(fnoxPath)
    result.fold(
      (err) => {
        console.error(`${RED}Error:${RESET} Failed to read fnox.toml: ${formatConfigError(err)}`)
        process.exit(1)
      },
      (keys) => {
        fnoxKeys = keys
      },
    )
  }

  const content = generateTemplate(options, fnoxKeys)

  const writeResult = Try(() => writeFileSync(outPath, content, "utf-8"))
  writeResult.fold(
    (err) => {
      console.error(`${RED}Error:${RESET} Failed to write ${CONFIG_FILENAME}: ${err}`)
      process.exit(1)
    },
    () => {
      console.log(`${GREEN}✓${RESET} Created ${BOLD}${CONFIG_FILENAME}${RESET} in ${CYAN}${dir}${RESET}`)
      if (fnoxKeys) {
        console.log(`  Scaffolded ${fnoxKeys.length} secret(s) from fnox.toml`)
      }
      console.log(`  ${BOLD}Next:${RESET} Fill in metadata for each secret`)
    },
  )
}
