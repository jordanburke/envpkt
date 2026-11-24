import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { type Either, Left, Option, Right } from "functype"
import { directSilentLogger } from "functype-log/direct"

import { fnoxExport } from "../fnox/cli.js"
import { detectFnox, fnoxAvailable } from "../fnox/detect.js"
import { describeIdentityError, INLINE_KEY_SOURCE, parseIdentityKeys, unwrapAgentKey } from "../fnox/identity.js"
import { extractFnoxKeys, readFnoxConfig } from "../fnox/parse.js"
import { formatAliasError, validateAliases } from "./alias.js"
import { computeAudit } from "./audit.js"
import { resolveConfig } from "./catalog.js"
import { expandPath, loadConfig, resolveConfigPath } from "./config.js"
import { resolveInlineKey, resolveKeyPath } from "./keygen.js"
import { isShellSafeSeparator, makeEnvNamer } from "./namespace.js"
import { unsealSecrets } from "./seal.js"
import type {
  AliasTable,
  AuditResult,
  BootError,
  BootOptions,
  BootResult,
  ConfigSource,
  EnvpktConfig,
  IdentityError,
  SecretMeta,
} from "./types.js"

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

/** The age secret keys to unseal with: None when no key source exists, Left when one exists but is unusable. */
export type SealKeys = Either<IdentityError, Option<ReadonlyArray<string>>>

const keysFrom = (keys: Either<IdentityError, ReadonlyArray<string>>): SealKeys => keys.map((k) => Option(k))

/**
 * Resolve the age secret keys for unsealing sealed packets. Precedence:
 *   config.identity.key_file > ENVPKT_AGE_KEY_FILE > ENVPKT_AGE_KEY (inline) > ~/.envpkt/age-key.txt
 * The inline key (CI secret) ranks above the homedir default so an explicit
 * env var beats a stray local key. It is parsed in memory and never written to disk.
 */
export const resolveSealIdentity = (config: EnvpktConfig, configDir: string): SealKeys => {
  if (config.identity?.key_file) {
    // Existence-check the configured key file. If it's missing, fall through to the rest of the
    // precedence chain (ENVPKT_AGE_KEY_FILE → inline → default) rather than returning a dead path
    // — so a config that declares a local key_file still resolves an inline CI key, and a truly
    // absent key surfaces as SealKeyUnavailable rather than a downstream decrypt failure.
    const keyFilePath = resolve(configDir, expandPath(config.identity.key_file))
    if (existsSync(keyFilePath)) {
      return keysFrom(unwrapAgentKey(keyFilePath))
    }
  }
  const envFile = process.env["ENVPKT_AGE_KEY_FILE"]
  if (envFile && existsSync(envFile)) {
    return keysFrom(unwrapAgentKey(envFile))
  }
  const inlineKey = resolveInlineKey().orUndefined()
  if (inlineKey) {
    return keysFrom(parseIdentityKeys(inlineKey, INLINE_KEY_SOURCE))
  }
  // The implicit homedir default is a "nothing was configured" convenience. When the config
  // explicitly names identity.key_file, that key identifies a specific recipient — falling back
  // to an unrelated ~/.envpkt/age-key.txt can only ever produce a "no identity matched any of the
  // recipients" decrypt error and mask the real problem (the configured key is absent). Skip it so
  // a configured-but-missing key surfaces cleanly as SealKeyUnavailable.
  if (!config.identity?.key_file) {
    const defaultPath = join(homedir(), ".envpkt", "age-key.txt")
    if (existsSync(defaultPath)) {
      return keysFrom(unwrapAgentKey(defaultPath))
    }
  }
  return Right(Option<ReadonlyArray<string>>(undefined))
}

/** Describe the seal-identity precedence chain with per-entry status, for a clear no-key error. */
export const describeSealKeySearch = (config: EnvpktConfig, configDir: string): ReadonlyArray<string> => {
  const keyFile = config.identity?.key_file
  const keyFileLine = keyFile
    ? `identity.key_file → ${resolve(configDir, expandPath(keyFile))} (${existsSync(resolve(configDir, expandPath(keyFile))) ? "found" : "missing"})`
    : `identity.key_file (not set)`
  const envFile = process.env["ENVPKT_AGE_KEY_FILE"]
  const envFileLine = envFile
    ? `ENVPKT_AGE_KEY_FILE → ${envFile} (${existsSync(envFile) ? "found" : "missing"})`
    : `ENVPKT_AGE_KEY_FILE (unset)`
  const inlineLine = resolveInlineKey().isEmpty ? `ENVPKT_AGE_KEY (unset)` : `ENVPKT_AGE_KEY (set, inline)`
  const defaultPath = join(homedir(), ".envpkt", "age-key.txt")
  // When identity.key_file is set, the homedir default is intentionally skipped (it would be the
  // wrong recipient) — reflect that here rather than reporting it as an available fallback.
  const defaultLine = keyFile
    ? `${defaultPath} (skipped — identity.key_file is set)`
    : `${defaultPath} (${existsSync(defaultPath) ? "found" : "missing"})`
  return [keyFileLine, envFileLine, inlineLine, defaultLine]
}

const resolveIdentityKey = (config: EnvpktConfig, configDir: string): IdentityKeyResult => {
  const identityPath = resolveIdentityFilePath(config, configDir, false)
  return identityPath.fold<IdentityKeyResult>(
    () => Right(Option<string>(undefined)),
    (path) =>
      unwrapAgentKey(path).fold<IdentityKeyResult>(
        (err) => Left(err),
        // fnox takes one key: the first, as before.
        (keys) => Right(Option(keys[0])),
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
): Either<BootError, ReadonlyArray<string>> => {
  if (audit.expired > 0 && failOnExpired && !warnOnly) {
    return Left({
      _tag: "AuditFailed" as const,
      audit,
      message: `${audit.expired} secret(s) have expired`,
    })
  }
  return Right(audit.expired > 0 && warnOnly ? [`${audit.expired} secret(s) have expired (warn-only mode)`] : [])
}

/**
 * Sealed values are declared, so a usable key is required. No key anywhere → SealKeyUnavailable;
 * a key that can't be used (an unreadable file, or a passphrase-protected, plugin or SSH key) → its
 * IdentityError. Either way
 * boot refuses rather than inject empty values — even under warnOnly, which governs soft issues
 * like expiry, not an absent key.
 */
const requireSealKeys = (
  config: EnvpktConfig,
  configDir: string,
  entries: Readonly<Record<string, SecretMeta>>,
): Either<BootError, ReadonlyArray<string>> =>
  resolveSealIdentity(config, configDir).flatMap((keys) =>
    keys.fold<Either<BootError, ReadonlyArray<string>>>(
      () =>
        Left({
          _tag: "SealKeyUnavailable" as const,
          sealedKeys: Object.keys(entries).filter((k) => !!entries[k]?.encrypted_value),
          searched: describeSealKeySearch(config, configDir),
          configuredKeyFile: config.identity?.key_file
            ? resolve(configDir, expandPath(config.identity.key_file))
            : undefined,
        }),
      (k) => Right(k),
    ),
  )

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

const checkEnvMisclassification = (config: EnvpktConfig): ReadonlyArray<string> => {
  const envEntries = config.env ?? {}
  return Object.entries(envEntries)
    .filter(([, entry]) => entry.value !== undefined && looksLikeSecret(entry.value))
    .map(([key]) => `[env.${key}] value looks like a secret — consider moving to [secret.${key}]`)
}

type BootLogger = ReturnType<typeof directSilentLogger.withContext>

/** What boot works from once every check that can refuse it has passed */
type BootPlan = {
  readonly loaded: ResolvedConfig
  readonly aliasTable: AliasTable
  readonly identityKey: Option<string>
  readonly unsealKeys: ReadonlyArray<string>
  readonly audit: AuditResult
  readonly expirationWarnings: ReadonlyArray<string>
}

/** What one resolution phase produced */
type PhaseResult = {
  readonly secrets: Readonly<Record<string, string>>
  readonly injected: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

const emptyPhase: PhaseResult = { secrets: {}, injected: [], skipped: [], warnings: [] }

/** Secret entries that carry their own value: aliases copy theirs from a target after resolution */
const nonAliasSecrets = (config: EnvpktConfig): Readonly<Record<string, SecretMeta>> =>
  Object.fromEntries(Object.entries(config.secret ?? {}).filter(([, meta]) => meta.from_key === undefined))

const hasSealed = (entries: Readonly<Record<string, SecretMeta>>): boolean =>
  Object.values(entries).some((meta) => !!meta.encrypted_value)

/** Load the config and run every check that can refuse the boot, in order */
const planBoot = (opts: BootOptions, log: BootLogger): Either<BootError, BootPlan> => {
  const failOnExpired = opts.failOnExpired !== false
  const warnOnly = opts.warnOnly ?? false

  return resolveAndLoad(opts).flatMap((loaded) =>
    validateAliases(loaded.config)
      .tapLeft((err) => log.warn("alias.validate.failed", { tag: err._tag, key: "key" in err ? err.key : undefined }))
      .mapLeft((err): BootError => err)
      .flatMap((aliasTable) => {
        log.debug("alias.validate.success", { aliases: aliasTable.entries.size })
        const { config, configDir } = loaded
        const sealedEntries = nonAliasSecrets(config)
        const hasSealedValues = hasSealed(sealedEntries)

        // A missing identity key is non-fatal when sealed values exist (identity may be a plain age identity)
        const identityKey = resolveIdentityKey(config, configDir).fold<Either<BootError, Option<string>>>(
          (err) => (hasSealedValues ? Right(Option<string>(undefined)) : Left(err)),
          (key) => Right(key),
        )

        return identityKey.flatMap((key) => {
          const audit = computeAudit(config, detectFnoxKeys(configDir), undefined, aliasTable)
          // Fail fast when sealed values are declared but no usable key resolves (requireSealKeys)
          const sealKeys: Either<BootError, ReadonlyArray<string>> = hasSealedValues
            ? requireSealKeys(config, configDir, sealedEntries)
            : Right([])
          return sealKeys.flatMap((unsealKeys) =>
            checkExpiration(audit, failOnExpired, warnOnly).map((expirationWarnings): BootPlan => ({
              loaded,
              aliasTable,
              identityKey: key,
              unsealKeys,
              audit,
              expirationWarnings,
            })),
          )
        })
      }),
  )
}

/** Phase 1: decrypt sealed values (encrypted_value in meta) */
const unsealPhase = async (
  entries: Readonly<Record<string, SecretMeta>>,
  keys: ReadonlyArray<string>,
  log: BootLogger,
): Promise<PhaseResult> =>
  (await unsealSecrets(entries, keys)).fold<PhaseResult>(
    (err) => {
      log.warn("phase.sealed.decrypt_failed", { message: err.message })
      return { ...emptyPhase, warnings: [`Sealed value decryption failed: ${err.message}`] }
    },
    (unsealed) => {
      const resolved = Object.keys(unsealed)
      resolved.forEach((key) => log.debug("phase.sealed.resolved", { key }))
      return { ...emptyPhase, secrets: unsealed, injected: resolved }
    },
  )

/** Phase 2: fnox for the keys no sealed value resolved */
const fnoxPhase = (
  keys: ReadonlyArray<string>,
  hasSealedValues: boolean,
  profile: string | undefined,
  identityKey: Option<string>,
  log: BootLogger,
): PhaseResult => {
  if (!fnoxAvailable()) {
    log.debug("phase.fnox.unavailable", { skipped: keys.length })
    const warning = hasSealedValues
      ? "fnox not available — unsealed secrets could not be resolved"
      : "fnox not available — no secrets injected"
    return { ...emptyPhase, skipped: keys, warnings: [warning] }
  }
  return fnoxExport(profile, identityKey.orUndefined()).fold<PhaseResult>(
    (err) => {
      log.warn("phase.fnox.export_failed", { message: err.message, skipped: keys.length })
      return { ...emptyPhase, skipped: keys, warnings: [`fnox export failed: ${err.message}`] }
    },
    (exported) => {
      const found = keys.filter((key) => key in exported)
      const notFound = keys.filter((key) => !(key in exported))
      found.forEach((key) => log.debug("phase.fnox.resolved", { key, profile }))
      notFound.forEach((key) => log.debug("phase.fnox.not_in_export", { key, profile }))
      return {
        secrets: Object.fromEntries(found.map((key) => [key, exported[key]!])),
        injected: found,
        skipped: notFound,
        warnings: [],
      }
    },
  )
}

/** Phase 3: each secret alias copies its target's resolved value, in order */
const aliasSecretPhase = (
  aliasKeys: ReadonlyArray<string>,
  aliasTable: AliasTable,
  resolved: Readonly<Record<string, string>>,
  log: BootLogger,
): PhaseResult =>
  aliasKeys.reduce<PhaseResult>(
    (acc, aliasKey) =>
      Option(aliasTable.entries.get(`secret.${aliasKey}`)).fold(
        () => acc,
        (entry) =>
          Option(acc.secrets[entry.targetKey]).fold<PhaseResult>(
            () => {
              log.debug("phase.alias.target_unresolved", { alias: aliasKey, target: entry.targetKey })
              return { ...acc, skipped: [...acc.skipped, aliasKey] }
            },
            (targetValue) => {
              log.debug("phase.alias.copied", { alias: aliasKey, target: entry.targetKey })
              return {
                ...acc,
                secrets: { ...acc.secrets, [aliasKey]: targetValue },
                injected: [...acc.injected, aliasKey],
              }
            },
          ),
      ),
    { ...emptyPhase, secrets: resolved },
  )

/** Inject the planned config's env defaults and secrets */
const runBoot = async (plan: BootPlan, opts: BootOptions, log: BootLogger): Promise<BootResult> => {
  const inject = opts.inject !== false
  const { aliasTable, audit } = plan
  const { config, configPath, configSource } = plan.loaded
  const secretEntries = config.secret ?? {}
  const envEntries = config.env ?? {}

  // Namespace boundary: internal records stay keyed by the logical name;
  // only process.env reads/writes use the namespaced wire name. Per-entry
  // `namespace` overrides the file-level prefix ("" opts out).
  const namer = makeEnvNamer(config)
  const secretEnv = (key: string): string => namer(key, secretEntries[key]?.namespace)
  const envEnv = (key: string): string => namer(key, envEntries[key]?.namespace)

  // Logical → wire name map for every known key, surfaced on BootResult so
  // shell-facing consumers (exec, env export) inject under the real name.
  const envNames: Readonly<Record<string, string>> = {
    ...Object.fromEntries(Object.keys(envEntries).map((k) => [k, envEnv(k)])),
    ...Object.fromEntries(Object.keys(secretEntries).map((k) => [k, secretEnv(k)])),
  }

  // Separate alias from non-alias entries. Aliases carry no value of
  // their own; they copy from their target after the real entries resolve.
  const nonAliasSecretEntries = nonAliasSecrets(config)
  const aliasSecretKeys = Object.entries(secretEntries)
    .filter(([, meta]) => meta.from_key !== undefined)
    .map(([k]) => k)
  const nonAliasEnvEntries = Object.entries(envEntries).filter(([, meta]) => meta.from_key === undefined)
  const aliasEnvKeys = Object.entries(envEntries)
    .filter(([, meta]) => meta.from_key !== undefined)
    .map(([k]) => k)
  const hasSealedValues = hasSealed(nonAliasSecretEntries)

  // Phase 0: env defaults, plus the misclassification and namespace checks.
  // A separator that would break shell consumers (e.g. '.', ':') is non-fatal:
  // injection still works for process.env-based consumers.
  const nsSeparator = config.namespace?.separator
  const setupWarnings: ReadonlyArray<string> = [
    ...plan.expirationWarnings,
    ...checkEnvMisclassification(config),
    ...(nsSeparator !== undefined && !isShellSafeSeparator(nsSeparator)
      ? [
          `[namespace] separator "${nsSeparator}" is not shell-safe — injected names won't be usable via shell $VAR/export. Use '_' or '__'.`,
        ]
      : []),
  ]

  // Non-alias env defaults: inject literal values only if process.env[key] is unset
  const directEnvDefaults: Readonly<Record<string, string>> = Object.fromEntries(
    nonAliasEnvEntries.flatMap(([key, entry]) =>
      Option(process.env[envEnv(key)]).fold<ReadonlyArray<readonly [string, string]>>(
        () =>
          Option(entry.value).fold<ReadonlyArray<readonly [string, string]>>(
            () => [],
            (v) => [[key, v] as const],
          ),
        () => [],
      ),
    ),
  )
  const directOverridden: ReadonlyArray<string> = nonAliasEnvEntries.flatMap(([key]) =>
    Option(process.env[envEnv(key)]).fold<ReadonlyArray<string>>(
      () => [],
      () => [key],
    ),
  )

  if (inject) {
    Object.entries(directEnvDefaults).forEach(([key, value]) => {
      process.env[envEnv(key)] = value
    })
  }

  const sealed = hasSealedValues ? await unsealPhase(nonAliasSecretEntries, plan.unsealKeys, log) : emptyPhase
  const remainingKeys = Object.keys(nonAliasSecretEntries).filter((k) => !sealed.injected.includes(k))
  const fnox =
    remainingKeys.length > 0
      ? fnoxPhase(remainingKeys, hasSealedValues, opts.profile, plan.identityKey, log)
      : emptyPhase
  const aliased = aliasSecretPhase(aliasSecretKeys, aliasTable, { ...sealed.secrets, ...fnox.secrets }, log)

  // Env alias pass: an alias copies its target's resolved env default unless its own variable is set
  const envAliases = aliasEnvKeys.reduce<{
    readonly envDefaults: Readonly<Record<string, string>>
    readonly overridden: ReadonlyArray<string>
  }>(
    (acc, aliasKey) =>
      Option(aliasTable.entries.get(`env.${aliasKey}`)).fold(
        () => acc,
        (entry) => {
          if (process.env[envEnv(aliasKey)] !== undefined) return { ...acc, overridden: [...acc.overridden, aliasKey] }
          const targetEntry = envEntries[entry.targetKey]
          if (targetEntry?.value === undefined) return acc
          // Prefer the already-injected/overriding value so alias tracks its target at runtime
          const resolvedTarget = process.env[envEnv(entry.targetKey)] ?? targetEntry.value
          return { ...acc, envDefaults: { ...acc.envDefaults, [aliasKey]: resolvedTarget } }
        },
      ),
    { envDefaults: directEnvDefaults, overridden: directOverridden },
  )

  if (inject) {
    // Inject env alias defaults (and any env defaults added by the alias pass)
    Object.entries(envAliases.envDefaults).forEach(([key, value]) => {
      process.env[envEnv(key)] ??= value
    })
    Object.entries(aliased.secrets).forEach(([key, value]) => {
      process.env[secretEnv(key)] = value
    })
  }

  return {
    audit,
    injected: [...sealed.injected, ...fnox.injected, ...aliased.injected],
    skipped: [...fnox.skipped, ...aliased.skipped],
    secrets: aliased.secrets,
    warnings: [...setupWarnings, ...sealed.warnings, ...fnox.warnings],
    envDefaults: envAliases.envDefaults,
    overridden: envAliases.overridden,
    envNames,
    configPath,
    configSource,
  }
}

/** Programmatic boot — resolves to Either<BootError, BootResult> */
export const bootSafe = async (options?: BootOptions): Promise<Either<BootError, BootResult>> => {
  const opts = options ?? {}
  const log = (opts.logger ?? directSilentLogger).withContext({ component: "envpkt.boot" })
  return planBoot(opts, log).foldAsync<Either<BootError, BootResult>>(
    (err) => Left(err),
    async (plan) => Right(await runBoot(plan, opts, log)),
  )
}

/* eslint-disable functype/prefer-either -- boot() is the intentional throwing wrapper; bootSafe() returns Either */
/** Programmatic boot — rejects with EnvpktBootError on failure (intentional throwing wrapper over bootSafe) */
export const boot = async (options?: BootOptions): Promise<BootResult> =>
  (await bootSafe(options)).fold(
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
    case "IdentityNotFound":
    case "IdentityUnreadable":
    case "NoIdentityKey":
    case "PassphraseProtectedIdentity":
    case "UnsupportedIdentity":
      return describeIdentityError(error)
    case "SealKeyUnavailable": {
      const keys = error.sealedKeys.length
      const searched = error.searched.map((line) => `  • ${line}`).join("\n")
      // If the config named a key_file, restoring it (not the homedir default) is the fix —
      // the default is deliberately skipped when key_file is set.
      const restoreLine = error.configuredKeyFile
        ? `  • Restore the configured key to ${error.configuredKeyFile} (or set ENVPKT_AGE_KEY_FILE / ENVPKT_AGE_KEY)`
        : `  • Restore your key to ~/.envpkt/age-key.txt (or set ENVPKT_AGE_KEY_FILE / ENVPKT_AGE_KEY)`
      return [
        `${keys} sealed secret(s) can't be decrypted — no age key found.`,
        `Searched (in order):`,
        searched,
        `Fix one:`,
        restoreLine,
        `  • Re-provision from source: envpkt seal --edit <KEY>`,
        `Refusing to inject empty values for sealed secrets.`,
      ].join("\n")
    }
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
