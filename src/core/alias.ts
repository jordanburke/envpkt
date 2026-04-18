import { type Either, Left, Option, Right } from "functype"

import type { AliasError, AliasTable, EnvpktConfig } from "./types.js"

export type AliasKind = "secret" | "env"

type ParsedRef = { readonly kind: AliasKind; readonly key: string }

const ALIAS_REF_RE = /^(secret|env)\.(.+)$/

const parseRef = (raw: string): Option<ParsedRef> => {
  const match = ALIAS_REF_RE.exec(raw)
  if (!match) return Option<ParsedRef>(undefined)
  const kind = match[1] as AliasKind
  const key = match[2]!
  if (!key) return Option<ParsedRef>(undefined)
  return Option({ kind, key })
}

type AliasEntry = { readonly kind: AliasKind; readonly targetKind: AliasKind; readonly targetKey: string }

const validateOneSecret = (
  key: string,
  meta: NonNullable<EnvpktConfig["secret"]>[string],
  secretEntries: NonNullable<EnvpktConfig["secret"]>,
): Either<AliasError, Option<AliasEntry>> => {
  if (meta.from_key === undefined) return Right(Option<AliasEntry>(undefined))
  const ref = meta.from_key

  if (meta.encrypted_value !== undefined) {
    return Left({ _tag: "AliasValueConflict", key, kind: "secret", field: "encrypted_value" })
  }

  return parseRef(ref).fold<Either<AliasError, Option<AliasEntry>>>(
    () => Left({ _tag: "AliasInvalidSyntax", key, kind: "secret", value: ref }),
    (parsed) => {
      if (parsed.kind !== "secret") {
        return Left({ _tag: "AliasCrossType", key, kind: "secret", targetKind: parsed.kind })
      }
      if (parsed.key === key) {
        return Left({ _tag: "AliasSelfReference", key: `secret.${key}` })
      }
      return Option(secretEntries[parsed.key]).fold<Either<AliasError, Option<AliasEntry>>>(
        () => Left({ _tag: "AliasTargetMissing", key: `secret.${key}`, target: ref }),
        (target) => {
          if (target.from_key !== undefined) {
            return Left({ _tag: "AliasChained", key: `secret.${key}`, target: ref })
          }
          return Right(Option({ kind: "secret", targetKind: "secret", targetKey: parsed.key }))
        },
      )
    },
  )
}

const validateOneEnv = (
  key: string,
  meta: NonNullable<EnvpktConfig["env"]>[string],
  envEntries: NonNullable<EnvpktConfig["env"]>,
): Either<AliasError, Option<AliasEntry>> => {
  if (meta.from_key === undefined) return Right(Option<AliasEntry>(undefined))
  const ref = meta.from_key

  if (meta.value !== undefined) {
    return Left({ _tag: "AliasValueConflict", key, kind: "env", field: "value" })
  }

  return parseRef(ref).fold<Either<AliasError, Option<AliasEntry>>>(
    () => Left({ _tag: "AliasInvalidSyntax", key, kind: "env", value: ref }),
    (parsed) => {
      if (parsed.kind !== "env") {
        return Left({ _tag: "AliasCrossType", key, kind: "env", targetKind: parsed.kind })
      }
      if (parsed.key === key) {
        return Left({ _tag: "AliasSelfReference", key: `env.${key}` })
      }
      return Option(envEntries[parsed.key]).fold<Either<AliasError, Option<AliasEntry>>>(
        () => Left({ _tag: "AliasTargetMissing", key: `env.${key}`, target: ref }),
        (target) => {
          if (target.from_key !== undefined) {
            return Left({ _tag: "AliasChained", key: `env.${key}`, target: ref })
          }
          return Right(Option({ kind: "env", targetKind: "env", targetKey: parsed.key }))
        },
      )
    },
  )
}

/**
 * Validate all `from_key` references in a resolved config. Produces an
 * AliasTable mapping each alias to its target, or an AliasError describing
 * the first failure.
 *
 * Rules:
 * - Ref must be "secret.<KEY>" or "env.<KEY>"
 * - Target must exist in the same resolved config
 * - Target must be the same type (secret→secret, env→env only)
 * - Target must not itself be a from_key entry (single hop only)
 * - Self-reference is rejected
 * - An alias entry cannot also carry a value field (encrypted_value for
 *   secrets, value for env)
 */
export const validateAliases = (config: EnvpktConfig): Either<AliasError, AliasTable> => {
  const secretEntries = config.secret ?? {}
  const envEntries = config.env ?? {}
  const entries = new Map<string, AliasEntry>()

  const secretResults = Object.entries(secretEntries).map(
    ([key, meta]) => [key, validateOneSecret(key, meta, secretEntries)] as const,
  )
  for (const [key, result] of secretResults) {
    const outcome = result.fold<AliasError | AliasEntry | undefined>(
      (err) => err,
      (opt) => opt.orUndefined(),
    )
    if (outcome === undefined) continue
    if ("_tag" in outcome) return Left(outcome)
    entries.set(`secret.${key}`, outcome)
  }

  const envResults = Object.entries(envEntries).map(
    ([key, meta]) => [key, validateOneEnv(key, meta, envEntries)] as const,
  )
  for (const [key, result] of envResults) {
    const outcome = result.fold<AliasError | AliasEntry | undefined>(
      (err) => err,
      (opt) => opt.orUndefined(),
    )
    if (outcome === undefined) continue
    if ("_tag" in outcome) return Left(outcome)
    entries.set(`env.${key}`, outcome)
  }

  return Right({ entries })
}

/** Does this secret entry point at another entry? */
export const isSecretAlias = (meta: { from_key?: string } | undefined): boolean => meta?.from_key !== undefined

/** Does this env entry point at another entry? */
export const isEnvAlias = (meta: { from_key?: string } | undefined): boolean => meta?.from_key !== undefined

/** Format an alias error into a human-readable message */
export const formatAliasError = (error: AliasError): string => {
  switch (error._tag) {
    case "AliasInvalidSyntax":
      return `[${error.kind}.${error.key}] from_key = "${error.value}" — expected "secret.<KEY>" or "env.<KEY>"`
    case "AliasTargetMissing":
      return `[${error.key}] from_key target "${error.target}" not found in config`
    case "AliasSelfReference":
      return `[${error.key}] from_key cannot reference itself`
    case "AliasChained":
      return `[${error.key}] from_key target "${error.target}" is itself an alias; chained aliases are not supported`
    case "AliasCrossType":
      return `[${error.kind}.${error.key}] cannot alias a ${error.targetKind} entry; same-type aliasing only (secret→secret, env→env)`
    case "AliasValueConflict":
      return `[${error.kind}.${error.key}] cannot declare both from_key and ${error.field}; an alias has no value of its own`
  }
}
