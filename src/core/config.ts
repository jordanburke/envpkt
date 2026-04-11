import { join, resolve } from "node:path"

import { TypeCompiler } from "@sinclair/typebox/compiler"
import type { Either } from "functype"
import { Left, List, Option, Right, Try } from "functype"
import { Env, Fs, Path, Platform } from "functype-os"
import { parse, TomlDate } from "smol-toml"

import { EnvpktConfigSchema } from "./schema.js"
import type { ConfigError, EnvpktConfig, ResolvedPath } from "./types.js"

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
    // eslint-disable-next-line functype/prefer-flatmap -- 1:1 recursive map, not a nested transformation
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, normalizeDates(v)]))
  }
  return obj
}

/** Expand ~ and $ENV_VAR / ${ENV_VAR} in a path string (silent — unresolved vars become "") */
export const expandPath = (p: string): string => {
  const homExpanded = Path.expandTilde(p)
  return homExpanded.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced: string, bare: string) => {
    const name = Option(braced).fold(
      () =>
        Option(bare).fold(
          () => "",
          (b) => b,
        ),
      (b) => b,
    )
    return Env.getOrDefault(name, "")
  })
}

/** Find envpkt.toml in the given directory */
export const findConfigPath = (dir: string): Option<string> => {
  const candidate = join(dir, CONFIG_FILENAME)
  return Fs.existsSync(candidate) ? Option(candidate) : Option<string>(undefined)
}

/**
 * Expand a path template that may contain a single `*` glob segment.
 * Returns all matching paths (or empty array if parent doesn't exist).
 * Non-glob paths return a single-element array if they exist.
 */
export const expandGlobPath = (expanded: string): ReadonlyArray<string> => {
  if (!expanded.includes("*")) {
    return Fs.existsSync(expanded) ? [expanded] : []
  }
  // Split into segments to find the one containing *
  const segments = expanded.split("/")
  const globIdx = segments.findIndex((s) => s.includes("*"))
  if (globIdx < 0) return []

  const parentDir = segments.slice(0, globIdx).join("/")
  const globSegment = segments[globIdx]!
  const suffix = segments.slice(globIdx + 1).join("/")

  if (!Fs.existsSync(parentDir)) return []

  const prefix = globSegment.replace(/\*.*$/, "")
  return Fs.readdirSync(parentDir).fold(
    () => [],
    (entries) =>
      entries
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => join(parentDir, entry, suffix))
        .filter((p) => Fs.existsSync(p))
        .toArray(),
  )
}

/** Env-var fallback paths for cases where Platform detection misses */
const ENV_FALLBACK_PATHS: ReadonlyArray<string> = [
  "$WINHOME/OneDrive/.envpkt/envpkt.toml",
  "$USERPROFILE/OneDrive/.envpkt/envpkt.toml",
  "$OneDrive/.envpkt/envpkt.toml",
  "$OneDriveConsumer/.envpkt/envpkt.toml",
  "$OneDriveCommercial/.envpkt/envpkt.toml",
  "$DROPBOX_PATH/.envpkt/envpkt.toml",
  "$GOOGLE_DRIVE/.envpkt/envpkt.toml",
  "$WINHOME/.envpkt/envpkt.toml",
  "$USERPROFILE/.envpkt/envpkt.toml",
]

/** Build discovery paths dynamically from Platform home and cloud storage detection */
const buildSearchPaths = (): ReadonlyArray<string> => {
  const homePaths = Platform.homeDirs()
    .toArray()
    .map((home) => join(home, ".envpkt", CONFIG_FILENAME))

  const cloudPaths = Platform.cloudStorageDirs()
    .toArray()
    .map((cloud) => join(cloud.path, ".envpkt", CONFIG_FILENAME))

  return [...homePaths, ...cloudPaths]
}

type DiscoveredConfig = { readonly path: string; readonly source: "cwd" | "search" }

/** Discover config by checking CWD, then ENVPKT_SEARCH_PATH, then dynamic Platform paths */
export const discoverConfig = (cwd?: string): Option<DiscoveredConfig> => {
  const dir = cwd ?? process.cwd()
  const cwdCandidate = join(dir, CONFIG_FILENAME)
  if (Fs.existsSync(cwdCandidate)) {
    const found: DiscoveredConfig = { path: cwdCandidate, source: "cwd" }
    return Option(found)
  }

  // Custom search paths (support globs for user-defined patterns)
  const customPaths = Env.get("ENVPKT_SEARCH_PATH").fold(
    () => [] as string[],
    (v) => v.split(":").filter(Boolean),
  )
  const customMatch = customPaths
    .map((template) => ({ template, expanded: expandPath(template) }))
    .filter(({ expanded }) => expanded !== "" && !expanded.startsWith("/.envpkt"))
    .map(({ expanded }) => expandGlobPath(expanded))
    .find((matches) => matches.length > 0)

  if (customMatch) {
    const found: DiscoveredConfig = { path: customMatch[0]!, source: "search" }
    return Option(found)
  }

  // Dynamic Platform-detected paths (homes + cloud storage, no globs needed)
  const platformMatch = buildSearchPaths().find((p) => Fs.existsSync(p))
  if (platformMatch) {
    const found: DiscoveredConfig = { path: platformMatch, source: "search" }
    return Option(found)
  }

  // Env-var fallback paths
  const fallbackMatch = ENV_FALLBACK_PATHS.map((template) => expandPath(template))
    .filter((expanded) => expanded !== "" && !expanded.startsWith("/.envpkt"))
    .find((expanded) => Fs.existsSync(expanded))

  if (fallbackMatch) {
    const found: DiscoveredConfig = { path: fallbackMatch, source: "search" }
    return Option(found)
  }

  return Option<DiscoveredConfig>(undefined)
}

/** Read a config file, returning Either<ConfigError, string> */
export const readConfigFile = (path: string): Either<ConfigError, string> => {
  if (!Fs.existsSync(path)) {
    return Left({ _tag: "FileNotFound", path } as const)
  }
  return Fs.readFileSync(path, "utf-8").mapLeft((err) => ({ _tag: "ReadError", message: err.message }) as const)
}

/** Ensure required fields have defaults for valid configs (e.g. agent configs with catalog may omit secret) */
const applyDefaults = (data: unknown): unknown => {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    const result = { ...obj }
    if (!("secret" in result)) {
      result.secret = {}
    }
    if (!("env" in result)) {
      result.env = {}
    }
    return result
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
  // eslint-disable-next-line functype/prefer-do-notation -- simple linear flatMap chain is clearer than Do notation here
  readConfigFile(path).flatMap(parseToml).flatMap(validateConfig)

/** Load config from CWD or discovery chain, returning path, source, and parsed config */
export const loadConfigFromCwd = (
  cwd?: string,
): Either<ConfigError, { path: string; source: "cwd" | "search"; config: EnvpktConfig }> =>
  discoverConfig(cwd).fold(
    () =>
      Left<ConfigError, { path: string; source: "cwd" | "search"; config: EnvpktConfig }>({
        _tag: "FileNotFound",
        path: join(cwd ?? process.cwd(), CONFIG_FILENAME),
      }),
    ({ path, source }) => loadConfig(path).map((config) => ({ path, source, config })),
  )

/**
 * Resolve config path via priority chain:
 * 1. Explicit flag path
 * 2. ENVPKT_CONFIG env var
 * 3. CWD + discovery chain (home dir, cloud storage, custom search paths)
 */
export const resolveConfigPath = (
  flagPath?: string,
  envVar?: string,
  cwd?: string,
): Either<ConfigError, ResolvedPath> => {
  if (flagPath) {
    const resolved = resolve(flagPath)
    const result: ResolvedPath = { path: resolved, source: "flag" }
    return Fs.existsSync(resolved) ? Right(result) : Left({ _tag: "FileNotFound", path: resolved } as const)
  }

  const envPath =
    envVar ??
    Env.get(ENV_VAR_CONFIG).fold(
      () => undefined,
      (v) => v,
    )
  if (envPath) {
    const resolved = resolve(envPath)
    const result: ResolvedPath = { path: resolved, source: "env" }
    return Fs.existsSync(resolved) ? Right(result) : Left({ _tag: "FileNotFound", path: resolved } as const)
  }

  return discoverConfig(cwd).fold<Either<ConfigError, ResolvedPath>>(
    () => Left({ _tag: "FileNotFound", path: join(cwd ?? process.cwd(), CONFIG_FILENAME) } as const),
    ({ path, source }) => Right({ path, source } as ResolvedPath),
  )
}
