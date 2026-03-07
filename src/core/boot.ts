import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { type Either, Left, Right } from "functype"

import { fnoxExport } from "../fnox/cli.js"
import { detectFnox, fnoxAvailable } from "../fnox/detect.js"
import { unwrapAgentKey } from "../fnox/identity.js"
import { extractFnoxKeys, readFnoxConfig } from "../fnox/parse.js"
import { computeAudit } from "./audit.js"
import { resolveConfig } from "./catalog.js"
import { expandPath, loadConfig, resolveConfigPath } from "./config.js"
import { resolveKeyPath } from "./keygen.js"
import { unsealSecrets } from "./seal.js"
import type { AuditResult, BootError, BootOptions, BootResult, ConfigSource, EnvpktConfig } from "./types.js"

type ResolvedConfig = {
  readonly config: EnvpktConfig
  readonly configPath: string
  readonly configDir: string
  readonly configSource: ConfigSource
}

const resolveAndLoad = (opts: BootOptions): Either<BootError, ResolvedConfig> =>
  resolveConfigPath(opts.configPath).fold<Either<BootError, ResolvedConfig>>(
    (err) => Left(err),
    ({ path: configPath, source: configSource }) =>
      loadConfig(configPath).fold<Either<BootError, ResolvedConfig>>(
        (err) => Left(err),
        (config) => {
          const configDir = dirname(configPath)
          return resolveConfig(config, configDir).fold<Either<BootError, ResolvedConfig>>(
            (err) => Left(err),
            (result) => Right({ config: result.config, configPath, configDir, configSource }),
          )
        },
      ),
  )

type IdentityKeyResult = Either<BootError, string | undefined>

/** Resolve identity file path with explicit fallback control */
const resolveIdentityFilePath = (
  config: EnvpktConfig,
  configDir: string,
  useDefaultFallback: boolean,
): string | undefined => {
  if (config.identity?.key_file) {
    return resolve(configDir, expandPath(config.identity.key_file))
  }
  if (!useDefaultFallback) return undefined
  const defaultPath = resolveKeyPath()
  return existsSync(defaultPath) ? defaultPath : undefined
}

const resolveIdentityKey = (config: EnvpktConfig, configDir: string): IdentityKeyResult => {
  const identityPath = resolveIdentityFilePath(config, configDir, false)
  if (!identityPath) {
    const result: IdentityKeyResult = Right(undefined as string | undefined)
    return result
  }
  return unwrapAgentKey(identityPath).fold<IdentityKeyResult>(
    (err) => Left(err),
    (key) => Right(key as string | undefined),
  )
}

const detectFnoxKeys = (configDir: string): ReadonlySet<string> =>
  detectFnox(configDir).fold(
    () => new Set<string>(),
    (fnoxPath) =>
      readFnoxConfig(fnoxPath).fold(
        () => new Set<string>(),
        (fnoxConfig) => extractFnoxKeys(fnoxConfig),
      ),
  )

const checkExpiration = (
  audit: AuditResult,
  failOnExpired: boolean,
  warnOnly: boolean,
): Either<BootError, string[]> => {
  const warnings: string[] = []
  if (audit.expired > 0 && failOnExpired && !warnOnly) {
    return Left({
      _tag: "AuditFailed" as const,
      audit,
      message: `${audit.expired} secret(s) have expired`,
    })
  }
  if (audit.expired > 0 && warnOnly) {
    warnings.push(`${audit.expired} secret(s) have expired (warn-only mode)`)
  }
  return Right(warnings)
}

const SECRET_PATTERNS = [
  /^sk-/,
  /^ghp_/,
  /^ghu_/,
  /^AKIA[0-9A-Z]{16}/,
  /^xox[bpras]-/,
  /:\/\/[^:]+:[^@]+@/,
  /^ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
]

const looksLikeSecret = (value: string): boolean => {
  if (SECRET_PATTERNS.some((p) => p.test(value))) return true
  // Base64 strings > 40 chars are suspicious
  if (value.length > 40 && /^[A-Za-z0-9+/=]+$/.test(value)) return true
  return false
}

const checkEnvMisclassification = (config: EnvpktConfig): string[] => {
  const warnings: string[] = []
  const envEntries = config.env ?? {}
  for (const [key, entry] of Object.entries(envEntries)) {
    if (looksLikeSecret(entry.value)) {
      warnings.push(`[env.${key}] value looks like a secret — consider moving to [secret.${key}]`)
    }
  }
  return warnings
}

/** Programmatic boot — returns Either<BootError, BootResult> */
export const bootSafe = (options?: BootOptions): Either<BootError, BootResult> => {
  const opts = options ?? {}
  const inject = opts.inject !== false
  const failOnExpired = opts.failOnExpired !== false
  const warnOnly = opts.warnOnly ?? false

  return resolveAndLoad(opts).flatMap(({ config, configPath, configDir, configSource }) => {
    const secretEntries = config.secret ?? {}
    const metaKeys = Object.keys(secretEntries)
    const hasSealedValues = metaKeys.some((k) => !!secretEntries[k]?.encrypted_value)

    // Resolve identity key — non-fatal when sealed values exist (identity may be a plain age identity)
    const identityKeyResult = resolveIdentityKey(config, configDir)
    const identityKey = identityKeyResult.fold(
      () => undefined,
      (k) => k,
    )

    // If identity key resolution failed AND no sealed values, propagate the error
    const identityKeyError = identityKeyResult.fold<BootError | undefined>(
      (err) => err,
      () => undefined,
    )
    if (identityKeyError && !hasSealedValues) {
      return Left(identityKeyError)
    }

    const fnoxKeys = detectFnoxKeys(configDir)
    const audit = computeAudit(config, fnoxKeys)

    return checkExpiration(audit, failOnExpired, warnOnly).map((warnings) => {
      const secrets: Record<string, string> = {}
      const injected: string[] = []
      const skipped: string[] = []

      // Phase 0: apply env defaults + misclassification check
      warnings.push(...checkEnvMisclassification(config))

      const envEntries = config.env ?? {}
      const envDefaults: Record<string, string> = {}
      const overridden: string[] = []

      for (const [key, entry] of Object.entries(envEntries)) {
        if (process.env[key] === undefined) {
          envDefaults[key] = entry.value
          if (inject) {
            process.env[key] = entry.value
          }
        } else {
          overridden.push(key)
        }
      }

      // Phase 1: try sealed values (encrypted_value in meta)
      const sealedKeys = new Set<string>()
      const identityFilePath = resolveIdentityFilePath(config, configDir, true)

      if (hasSealedValues && identityFilePath) {
        unsealSecrets(secretEntries, identityFilePath).fold(
          (err) => {
            warnings.push(`Sealed value decryption failed: ${err.message}`)
          },
          (unsealed) => {
            for (const [key, value] of Object.entries(unsealed)) {
              secrets[key] = value
              injected.push(key)
              sealedKeys.add(key)
            }
          },
        )
      }

      // Phase 2: fnox for remaining keys
      const remainingKeys = metaKeys.filter((k) => !sealedKeys.has(k))

      if (remainingKeys.length > 0) {
        if (fnoxAvailable()) {
          fnoxExport(opts.profile, identityKey).fold(
            (err) => {
              warnings.push(`fnox export failed: ${err.message}`)
              for (const key of remainingKeys) {
                skipped.push(key)
              }
            },
            (exported) => {
              for (const key of remainingKeys) {
                if (key in exported) {
                  secrets[key] = exported[key]!
                  injected.push(key)
                } else {
                  skipped.push(key)
                }
              }
            },
          )
        } else {
          if (!hasSealedValues) {
            warnings.push("fnox not available — no secrets injected")
          }
          for (const key of remainingKeys) {
            skipped.push(key)
          }
        }
      }

      if (inject) {
        for (const [key, value] of Object.entries(secrets)) {
          process.env[key] = value
        }
      }

      return {
        audit,
        injected: injected as ReadonlyArray<string>,
        skipped: skipped as ReadonlyArray<string>,
        secrets: secrets as Readonly<Record<string, string>>,
        warnings: warnings as ReadonlyArray<string>,
        envDefaults: envDefaults as Readonly<Record<string, string>>,
        overridden: overridden as ReadonlyArray<string>,
        configPath,
        configSource,
      }
    })
  })
}

/** Programmatic boot — throws EnvpktBootError on failure */
export const boot = (options?: BootOptions): BootResult =>
  bootSafe(options).fold(
    (err) => {
      throw new EnvpktBootError(err)
    },
    (r) => r,
  )

/** Error class for boot() failures */
export class EnvpktBootError extends Error {
  readonly error: BootError

  constructor(error: BootError) {
    super(formatBootError(error))
    this.name = "EnvpktBootError"
    this.error = error
  }
}

const formatBootError = (error: BootError): string => {
  switch (error._tag) {
    case "FileNotFound":
      return `Config not found: ${error.path}`
    case "ParseError":
      return `Config parse error: ${error.message}`
    case "ValidationError":
      return `Config validation failed: ${error.errors.toArray().join(", ")}`
    case "ReadError":
      return `Config read error: ${error.message}`
    case "FnoxNotFound":
      return `fnox not found: ${error.message}`
    case "FnoxCliError":
      return `fnox CLI error: ${error.message}`
    case "FnoxParseError":
      return `fnox parse error: ${error.message}`
    case "AuditFailed":
      return `Audit failed: ${error.message}`
    case "CatalogNotFound":
      return `Catalog not found: ${error.path}`
    case "CatalogLoadError":
      return `Catalog load error: ${error.message}`
    case "SecretNotInCatalog":
      return `Secret "${error.key}" not found in catalog: ${error.catalogPath}`
    case "MissingSecretsList":
      return `Missing secrets list: ${error.message}`
    case "AgeNotFound":
      return `age not found: ${error.message}`
    case "DecryptFailed":
      return `Decrypt failed: ${error.message}`
    case "IdentityNotFound":
      return `Identity file not found: ${error.path}`
    default:
      return `Boot error: ${JSON.stringify(error)}`
  }
}
