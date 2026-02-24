import { dirname, resolve } from "node:path"

import { type Either, Left, Right } from "functype"

import { fnoxExport } from "../fnox/cli.js"
import { detectFnox, fnoxAvailable } from "../fnox/detect.js"
import { unwrapAgentKey } from "../fnox/identity.js"
import { extractFnoxKeys, readFnoxConfig } from "../fnox/parse.js"
import { computeAudit } from "./audit.js"
import { loadConfig, resolveConfigPath } from "./config.js"
import type { AuditResult, BootError, BootOptions, BootResult, EnvpktConfig } from "./types.js"

type ResolvedConfig = {
  readonly config: EnvpktConfig
  readonly configPath: string
  readonly configDir: string
}

const resolveAndLoad = (opts: BootOptions): Either<BootError, ResolvedConfig> =>
  resolveConfigPath(opts.configPath).fold<Either<BootError, ResolvedConfig>>(
    (err) => Left(err),
    (configPath) =>
      loadConfig(configPath).fold<Either<BootError, ResolvedConfig>>(
        (err) => Left(err),
        (config) => Right({ config, configPath, configDir: dirname(configPath) }),
      ),
  )

type AgentKeyResult = Either<BootError, string | undefined>

const resolveAgentKey = (config: EnvpktConfig, configDir: string): AgentKeyResult => {
  if (!config.agent?.identity) {
    const result: AgentKeyResult = Right(undefined as string | undefined)
    return result
  }
  const identityPath = resolve(configDir, config.agent.identity)
  return unwrapAgentKey(identityPath).fold<AgentKeyResult>(
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

/** Programmatic boot — returns Either<BootError, BootResult> */
export const bootSafe = (options?: BootOptions): Either<BootError, BootResult> => {
  const opts = options ?? {}
  const inject = opts.inject !== false
  const failOnExpired = opts.failOnExpired !== false
  const warnOnly = opts.warnOnly ?? false

  return resolveAndLoad(opts).flatMap(({ config, configDir }) =>
    resolveAgentKey(config, configDir).flatMap((agentKey) => {
      const fnoxKeys = detectFnoxKeys(configDir)
      const audit = computeAudit(config, fnoxKeys)

      return checkExpiration(audit, failOnExpired, warnOnly).map((warnings) => {
        const secrets: Record<string, string> = {}
        const injected: string[] = []
        const skipped: string[] = []
        const metaKeys = Object.keys(config.meta)

        if (fnoxAvailable()) {
          fnoxExport(opts.profile, agentKey).fold(
            (err) => {
              warnings.push(`fnox export failed: ${err.message}`)
              for (const key of metaKeys) {
                skipped.push(key)
              }
            },
            (exported) => {
              for (const key of metaKeys) {
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
          warnings.push("fnox not available — no secrets injected")
          for (const key of metaKeys) {
            skipped.push(key)
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
        }
      })
    }),
  )
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
