import type { Either } from "functype"

import { formatAliasError, validateAliases } from "./alias.js"
import { parseToml, validateConfig } from "./config.js"
import type { AliasError, ConfigError, EnvpktConfig } from "./types.js"

/** Union of structural validation failures — what `validateRawConfig` can return on the Left. */
export type ValidationError = ConfigError | AliasError

/**
 * Validate a raw TOML string as a complete envpkt config: parse → schema → aliases.
 *
 * Used by write-path CLI commands to verify the post-edit file would still be
 * structurally valid before persisting. Catalog resolution is intentionally
 * excluded — catalog issues depend on external files, not on the local edit,
 * and `envpkt validate` covers them as a separate explicit check.
 */
export const validateRawConfig = (raw: string): Either<ValidationError, EnvpktConfig> =>
  // eslint-disable-next-line functype/prefer-do-notation -- linear flatMap chain reads cleaner than Do here
  parseToml(raw)
    .flatMap(validateConfig)
    .flatMap((config) => validateAliases(config).map(() => config))

/** Human-readable one-liner for any ValidationError tag. */
export const formatValidationError = (err: ValidationError): string => {
  switch (err._tag) {
    case "FileNotFound":
      return `Config file not found: ${err.path}`
    case "ParseError":
      return `TOML parse error: ${err.message}`
    case "ValidationError":
      return `Schema validation failed: ${err.errors.toArray().join("; ")}`
    case "ReadError":
      return `Read error: ${err.message}`
    case "AliasInvalidSyntax":
    case "AliasTargetMissing":
    case "AliasSelfReference":
    case "AliasChained":
    case "AliasCrossType":
    case "AliasValueConflict":
      return formatAliasError(err)
  }
}
