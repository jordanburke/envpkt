import { existsSync, readFileSync } from "node:fs"

import type { Either } from "functype"
import { Left, Try } from "functype"

import { parseIdentityFile } from "../core/age.js"
import type { IdentityError } from "../core/types.js"

/** The `source` name for the inline key in identity errors. */
export const INLINE_KEY_SOURCE = "ENVPKT_AGE_KEY"

/**
 * Read the age secret keys (`AGE-SECRET-KEY-…`) from identity text, such as a key file's content
 * or the inline `ENVPKT_AGE_KEY`. `source` names it in errors.
 */
export const parseIdentityKeys = (content: string, source: string): Either<IdentityError, ReadonlyArray<string>> =>
  parseIdentityFile(content).mapLeft((err): IdentityError => ({ ...err, source }))

/**
 * Read every secret key from a plain age identity file (as written by `envpkt keygen` or
 * `age-keygen`). A missing or unreadable file, and passphrase-protected, plugin and SSH key files,
 * are rejected with a typed error.
 */
export const unwrapAgentKey = (identityPath: string): Either<IdentityError, ReadonlyArray<string>> => {
  if (!existsSync(identityPath)) {
    return Left({ _tag: "IdentityNotFound", path: identityPath } as const)
  }

  return Try(() => readFileSync(identityPath, "utf-8")).fold<Either<IdentityError, ReadonlyArray<string>>>(
    (err) => Left({ _tag: "IdentityUnreadable", path: identityPath, message: err.message } as const),
    (content) => parseIdentityKeys(content, identityPath),
  )
}

const IDENTITY_ERROR_TAGS: ReadonlySet<string> = new Set<IdentityError["_tag"]>([
  "IdentityNotFound",
  "IdentityUnreadable",
  "NoIdentityKey",
  "PassphraseProtectedIdentity",
  "UnsupportedIdentity",
])

/** True when `err` is about the age key itself rather than the config. */
export const isIdentityError = (err: { readonly _tag: string }): err is IdentityError =>
  IDENTITY_ERROR_TAGS.has(err._tag)

const UNSUPPORTED_KIND = { plugin: "an age plugin key", ssh: "an SSH key", unknown: "not an age secret key" } as const

/** Explain an identity error. Never includes key material. */
export const describeIdentityError = (err: IdentityError): string => {
  switch (err._tag) {
    case "IdentityNotFound":
      return `Identity file not found: ${err.path}`
    case "IdentityUnreadable":
      return `Can't read key file ${err.path}: ${err.message}`
    case "NoIdentityKey":
      return `${err.source} has no age secret key (AGE-SECRET-KEY-…)`
    case "PassphraseProtectedIdentity":
      return err.source === INLINE_KEY_SOURCE
        ? `${INLINE_KEY_SOURCE} holds a passphrase-protected key, which envpkt can't read. Set it to the plain key file's content (its AGE-SECRET-KEY-… line).`
        : `${err.source} is a passphrase-protected key file, which envpkt can't read. Unwrap it once with \`age -d -o <plain-key-file> ${err.source}\` and point envpkt at the plain file.`
    case "UnsupportedIdentity":
      return `${err.source} line ${err.line} is ${UNSUPPORTED_KIND[err.kind]}; envpkt reads plain age secret keys (AGE-SECRET-KEY-…) only`
  }
}
