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
# consumer = "api"           # What type: api | database | saas | infra | other
# env_var = "${key.toUpperCase()}"
# vault_path = ""            # Where: path in secret manager
# purpose = ""               # Why: what this secret enables
# capabilities = []          # What operations this grants
created = "${todayIso()}"
# expires = ""               # When: YYYY-MM-DD expiration date
# rotation_url = ""          # How: URL for rotation procedure
# provisioner = "manual"     # How: manual | fnox | vault | ci
# tags = []
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
name = "${name}"${caps}${exp}
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
  lines.push(`warn_before_days = 30`)
  lines.push(`stale_after_days = 365`)
  lines.push(`# require_rotation_url = false`)
  lines.push(`# require_purpose = false`)
  lines.push(``)

  if (fnoxKeys && fnoxKeys.length > 0) {
    lines.push(`# Secrets detected from fnox.toml`)
    for (const key of fnoxKeys) {
      lines.push(generateSecretBlock(key))
    }
  } else {
    lines.push(`# Add your secret metadata below. Each [meta.<key>] answers:`)
    lines.push(`#   What service? Where stored? Why needed? When expires? How provisioned?`)
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
      console.log(`  ${BOLD}Next:${RESET} Fill in the five-W fields for each secret (What/Where/Why/When/How)`)
    },
  )
}
