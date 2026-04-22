import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { type Either, Left, Option, Right } from "functype"
// Import from the /direct subpath, not the barrel — the barrel eagerly loads
// loglayer via ./layers and ./adapter even if we only want the silent no-op.
import { directSilentLogger } from "functype-log/direct"

import { fnoxExport } from "../fnox/cli.js"
import { detectFnox, fnoxAvailable } from "../fnox/detect.js"
import { unwrapAgentKey } from "../fnox/identity.js"
import { extractFnoxKeys, readFnoxConfig } from "../fnox/parse.js"
import { formatAliasError, validateAliases } from "./alias.js"
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

type IdentityKeyResult = Either<BootError, Option<string>>

/** Resolve identity file path with explicit fallback control */
const resolveIdentityFilePath = (
  config: EnvpktConfig,
  configDir: string,
  useDefaultFallback: boolean,
): Option<string> => {
  if (config.identity?.key_file) {
    return Option(resolve(configDir, expandPath(config.identity.key_file)))
  }
  if (!useDefaultFallback) return Option<string>(undefined)
  const defaultPath = resolveKeyPath()
  return existsSync(defaultPath) ? Option(defaultPath) : Option<string>(undefined)
}

const resolveIdentityKey = (config: EnvpktConfig, configDir: string): IdentityKeyResult => {
  const identityPath = resolveIdentityFilePath(config, configDir, false)
  return identityPath.fold<IdentityKeyResult>(
    () => Right(Option<string>(undefined)),
    (path) =>
      unwrapAgentKey(path).fold<IdentityKeyResult>(
        (err) => Left(err),
        (key) => Right(Option(key)),
      ),
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
  const envEntries = config.env ?? {}
  return Object.entries(envEntries)
    .filter(([, entry]) => entry.value !== undefined && looksLikeSecret(entry.value))
    .map(([key]) => `[env.${key}] value looks like a secret — consider moving to [secret.${key}]`)
}

/** Programmatic boot — returns Either<BootError, BootResult> */
export const bootSafe = (options?: BootOptions): Either<BootError, BootResult> => {
  const opts = options ?? {}
  const inject = opts.inject !== false
  const failOnExpired = opts.failOnExpired !== false
  const warnOnly = opts.warnOnly ?? false
  const log = (opts.logger ?? directSilentLogger).withContext({ component: "envpkt.boot" })

  // eslint-disable-next-line functype/prefer-do-notation -- multi-phase boot pipeline with side effects is clearer as explicit flatMap
  return resolveAndLoad(opts).flatMap(({ config, configPath, configDir, configSource }) =>
    validateAliases(config).fold<Either<BootError, BootResult>>(
      (err) => {
        log.warn("alias.validate.failed", { tag: err._tag, key: "key" in err ? err.key : undefined })
        return Left(err)
      },
      (aliasTable) => {
        log.debug("alias.validate.success", { aliases: aliasTable.entries.size })
        const secretEntries = config.secret ?? {}
        const envEntries = config.env ?? {}

        // Separate alias from non-alias entries. Aliases carry no value of
        // their own; they copy from their target after the real entries resolve.
        const nonAliasSecretEntries = Object.fromEntries(
          Object.entries(secretEntries).filter(([, meta]) => meta.from_key === undefined),
        )
        const aliasSecretKeys = Object.entries(secretEntries)
          .filter(([, meta]) => meta.from_key !== undefined)
          .map(([k]) => k)
        const nonAliasEnvEntries = Object.entries(envEntries).filter(([, meta]) => meta.from_key === undefined)
        const aliasEnvKeys = Object.entries(envEntries)
          .filter(([, meta]) => meta.from_key !== undefined)
          .map(([k]) => k)

        const nonAliasMetaKeys = Object.keys(nonAliasSecretEntries)
        const hasSealedValues = Object.values(nonAliasSecretEntries).some((meta) => !!meta.encrypted_value)

        // Resolve identity key — non-fatal when sealed values exist (identity may be a plain age identity)
        const identityKeyResult = resolveIdentityKey(config, configDir)
        const identityKey = identityKeyResult.fold(
          () => Option<string>(undefined),
          (k) => k,
        )

        // If identity key resolution failed AND no sealed values, propagate the error
        if (identityKeyResult.isLeft() && !hasSealedValues) {
          return identityKeyResult.fold<Either<BootError, BootResult>>(
            (err) => Left(err),
            () => Left({ _tag: "ReadError", message: "unexpected" } as BootError),
          )
        }

        const fnoxKeys = detectFnoxKeys(configDir)
        const audit = computeAudit(config, fnoxKeys, undefined, aliasTable)

        return checkExpiration(audit, failOnExpired, warnOnly).map((warnings) => {
          const secrets: Record<string, string> = {}
          const injected: string[] = []
          const skipped: string[] = []

          // Phase 0: apply env defaults + misclassification check
          warnings.push(...checkEnvMisclassification(config))

          // Non-alias env defaults: inject literal values only if process.env[key] is unset
          const envDefaults: Record<string, string> = Object.fromEntries(
            nonAliasEnvEntries.flatMap(([key, entry]) =>
              Option(process.env[key]).fold<ReadonlyArray<readonly [string, string]>>(
                () => (entry.value !== undefined ? [[key, entry.value] as const] : []),
                () => [],
              ),
            ),
          )
          const overridden: string[] = nonAliasEnvEntries.flatMap(([key]) =>
            Option(process.env[key]).fold<string[]>(
              () => [],
              () => [key],
            ),
          )

          if (inject) {
            Object.entries(envDefaults).forEach(([key, value]) => {
              process.env[key] = value
            })
          }

          // Phase 1: try sealed values (encrypted_value in meta) — non-alias only
          const sealedKeys = new Set<string>()
          const identityFilePath = resolveIdentityFilePath(config, configDir, true)

          if (hasSealedValues) {
            identityFilePath.fold(
              () => {
                log.warn("phase.sealed.no_identity_file", {
                  sealed_keys: nonAliasMetaKeys.filter((k) => !!nonAliasSecretEntries[k]?.encrypted_value).length,
                })
                warnings.push("Sealed values found but no identity file available for decryption")
              },
              (idPath) => {
                unsealSecrets(nonAliasSecretEntries, idPath).fold(
                  (err) => {
                    log.warn("phase.sealed.decrypt_failed", { message: err.message })
                    warnings.push(`Sealed value decryption failed: ${err.message}`)
                  },
                  (unsealed) => {
                    const unsealedEntries = Object.entries(unsealed)
                    Object.assign(secrets, unsealed)
                    injected.push(...unsealedEntries.map(([key]) => key))
                    unsealedEntries.forEach(([key]) => {
                      sealedKeys.add(key)
                      log.debug("phase.sealed.resolved", { key })
                    })
                  },
                )
              },
            )
          }

          // Phase 2: fnox for remaining non-alias keys
          const remainingKeys = nonAliasMetaKeys.filter((k) => !sealedKeys.has(k))

          if (remainingKeys.length > 0) {
            if (fnoxAvailable()) {
              fnoxExport(opts.profile, identityKey.orUndefined()).fold(
                (err) => {
                  log.warn("phase.fnox.export_failed", { message: err.message, skipped: remainingKeys.length })
                  warnings.push(`fnox export failed: ${err.message}`)
                  skipped.push(...remainingKeys)
                },
                (exported) => {
                  const found = remainingKeys.filter((key) => key in exported)
                  const notFound = remainingKeys.filter((key) => !(key in exported))
                  found.forEach((key) => {
                    secrets[key] = exported[key]!
                    log.debug("phase.fnox.resolved", { key, profile: opts.profile })
                  })
                  notFound.forEach((key) => {
                    log.debug("phase.fnox.not_in_export", { key, profile: opts.profile })
                  })
                  injected.push(...found)
                  skipped.push(...notFound)
                },
              )
            } else {
              log.debug("phase.fnox.unavailable", { skipped: remainingKeys.length })
              if (!hasSealedValues) {
                warnings.push("fnox not available — no secrets injected")
              } else {
                warnings.push("fnox not available — unsealed secrets could not be resolved")
              }
              skipped.push(...remainingKeys)
            }
          }

          // Phase 3: alias copy pass — aliases reuse their target's resolved value
          aliasSecretKeys.forEach((aliasKey) => {
            const entry = aliasTable.entries.get(`secret.${aliasKey}`)
            if (!entry) return
            const targetValue = secrets[entry.targetKey]
            if (targetValue !== undefined) {
              secrets[aliasKey] = targetValue
              injected.push(aliasKey)
              log.debug("phase.alias.copied", { alias: aliasKey, target: entry.targetKey })
            } else {
              skipped.push(aliasKey)
              log.debug("phase.alias.target_unresolved", { alias: aliasKey, target: entry.targetKey })
            }
          })

          // Env alias copy pass — copy target's resolved env default if canonical not already set
          aliasEnvKeys.forEach((aliasKey) => {
            const entry = aliasTable.entries.get(`env.${aliasKey}`)
            if (!entry) return
            if (process.env[aliasKey] !== undefined) {
              overridden.push(aliasKey)
              return
            }
            const targetEntry = envEntries[entry.targetKey]
            if (targetEntry?.value === undefined) return
            // Prefer the already-injected/overriding value so alias tracks its target at runtime
            const resolvedTarget = process.env[entry.targetKey] ?? targetEntry.value
            envDefaults[aliasKey] = resolvedTarget
          })

          if (inject) {
            // Inject env alias defaults (and any env defaults added by the alias pass)
            Object.entries(envDefaults).forEach(([key, value]) => {
              process.env[key] ??= value
            })
            Object.entries(secrets).forEach(([key, value]) => {
              process.env[key] = value
            })
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
      },
    ),
  )
}

/* eslint-disable functype/prefer-either -- boot() is the intentional throwing wrapper; bootSafe() returns Either */
/** Programmatic boot — throws EnvpktBootError on failure (intentional throwing wrapper over bootSafe) */
export const boot = (options?: BootOptions): BootResult =>
  bootSafe(options).fold(
    (err) => {
      throw new EnvpktBootError(err)
    },
    (r) => r,
  )
/* eslint-enable functype/prefer-either */

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
    case "AliasInvalidSyntax":
    case "AliasTargetMissing":
    case "AliasSelfReference":
    case "AliasChained":
    case "AliasCrossType":
    case "AliasValueConflict":
      return formatAliasError(error)
    default:
      return `Boot error: ${JSON.stringify(error)}`
  }
}
