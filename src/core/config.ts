import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { TypeCompiler } from "@sinclair/typebox/compiler"
import { Either, Left, List, Option, Right, Try } from "functype"
import { parse, TomlDate } from "smol-toml"

import { EnvpktConfigSchema } from "./schema.js"
import type { ConfigError, EnvpktConfig } from "./types.js"

const CONFIG_FILENAME = "envpkt.toml"
const ENV_VAR_CONFIG = "ENVPKT_CONFIG"

const compiledSchema = TypeCompiler.Compile(EnvpktConfigSchema)

/** Recursively convert TomlDate instances to ISO date strings */
const normalizeDates = (obj: unknown): unknown => {
  if (obj instanceof TomlDate) {
    return obj.toISOString().split("T")[0]
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeDates)
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, normalizeDates(v)]))
  }
  return obj
}

/** Find envpkt.toml in the given directory */
export const findConfigPath = (dir: string): Option<string> => {
  const candidate = join(dir, CONFIG_FILENAME)
  return existsSync(candidate) ? Option(candidate) : Option<string>(undefined)
}

/** Read a config file, returning Either<ConfigError, string> */
export const readConfigFile = (path: string): Either<ConfigError, string> => {
  if (!existsSync(path)) {
    return Left({ _tag: "FileNotFound", path } as const)
  }
  return Try(() => readFileSync(path, "utf-8")).fold(
    (err) => Left({ _tag: "ReadError", message: String(err) } as const),
    (content) => Right(content),
  )
}

/** Ensure required fields have defaults for valid configs (e.g. agent configs with catalog may omit meta) */
const applyDefaults = (data: unknown): unknown => {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    if (!("meta" in obj)) {
      return { ...obj, meta: {} }
    }
  }
  return data
}

/** Parse a TOML string, returning Either<ConfigError, unknown> */
export const parseToml = (raw: string): Either<ConfigError, unknown> =>
  Try(() => parse(raw)).fold(
    (err) => Left({ _tag: "ParseError", message: String(err) } as const),
    (data) => Right(applyDefaults(normalizeDates(data))),
  )

/** Validate parsed data against the TypeBox schema */
export const validateConfig = (data: unknown): Either<ConfigError, EnvpktConfig> => {
  if (compiledSchema.Check(data)) {
    return Right(data)
  }
  const errors = List([...compiledSchema.Errors(data)].map((e) => `${e.path}: ${e.message}`))
  return Left({ _tag: "ValidationError", errors } as const)
}

/** Load and validate an envpkt.toml from a file path */
export const loadConfig = (path: string): Either<ConfigError, EnvpktConfig> =>
  readConfigFile(path).flatMap(parseToml).flatMap(validateConfig)

/** Load config from CWD, returning both path and parsed config */
export const loadConfigFromCwd = (cwd?: string): Either<ConfigError, { path: string; config: EnvpktConfig }> => {
  const dir = cwd ?? process.cwd()
  return findConfigPath(dir).fold(
    () => Left({ _tag: "FileNotFound", path: join(dir, CONFIG_FILENAME) } as const),
    (path) => loadConfig(path).map((config) => ({ path, config })),
  )
}

/**
 * Resolve config path via priority chain:
 * 1. Explicit flag path
 * 2. ENVPKT_CONFIG env var
 * 3. CWD discovery
 */
export const resolveConfigPath = (flagPath?: string, envVar?: string, cwd?: string): Either<ConfigError, string> => {
  if (flagPath) {
    const resolved = resolve(flagPath)
    return existsSync(resolved) ? Right(resolved) : Left({ _tag: "FileNotFound", path: resolved } as const)
  }

  const envPath = envVar ?? process.env[ENV_VAR_CONFIG]
  if (envPath) {
    const resolved = resolve(envPath)
    return existsSync(resolved) ? Right(resolved) : Left({ _tag: "FileNotFound", path: resolved } as const)
  }

  const dir = cwd ?? process.cwd()
  return findConfigPath(dir).fold(
    () => Left({ _tag: "FileNotFound", path: join(dir, CONFIG_FILENAME) } as const),
    (path) => Right(path),
  )
}
