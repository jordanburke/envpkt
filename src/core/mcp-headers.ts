import { type Either, Left, Right, Set } from "functype"

import type { EnvpktConfig, McpConfigError, McpHeadersError } from "./types.js"

const DEFAULT_HEADER = "Authorization"
const DEFAULT_SCHEME = "Bearer"

/** RFC 9110 `token`: the legal characters of a header name (and of an auth scheme). */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Characters that would split or corrupt an HTTP header value. */
const UNSAFE_VALUE_RE = /[\r\n\0]/

type Binding = { readonly key: string; readonly server: string; readonly header: string; readonly scheme: string }

/** Flatten every `[secret.*].mcp` entry into one binding per (secret, server), with defaults applied. */
const collectBindings = (config: EnvpktConfig): ReadonlyArray<Binding> =>
  Object.entries(config.secret ?? {}).flatMap(([key, meta]) =>
    (meta.mcp ?? []).map((m) => ({
      key,
      server: m.server,
      // `??`, not `||`: an empty scheme is the documented opt-out that sends the raw value.
      header: m.header ?? DEFAULT_HEADER,
      scheme: m.scheme ?? DEFAULT_SCHEME,
    })),
  )

/**
 * Check bindings for structural problems: header names and schemes that are not HTTP
 * tokens, and two bindings claiming the same (server, header) pair. Header names compare
 * case-insensitively, as HTTP does.
 */
const validateBindings = (bindings: ReadonlyArray<Binding>): Either<McpConfigError, void> => {
  const badHeader = bindings.find((b) => !TOKEN_RE.test(b.header))
  if (badHeader) {
    return Left({ _tag: "McpHeaderInvalid", key: badHeader.key, server: badHeader.server, header: badHeader.header })
  }

  const badScheme = bindings.find((b) => b.scheme !== "" && !TOKEN_RE.test(b.scheme))
  if (badScheme) {
    return Left({ _tag: "McpSchemeInvalid", key: badScheme.key, server: badScheme.server, scheme: badScheme.scheme })
  }

  const claims = bindings.reduce<Record<string, ReadonlyArray<Binding>>>((acc, b) => {
    const id = `${b.server}\u0000${b.header.toLowerCase()}`
    return { ...acc, [id]: [...(acc[id] ?? []), b] }
  }, {})
  const clash = Object.values(claims).find((group) => group.length > 1)
  if (clash) {
    const first = clash[0]!
    return Left({
      _tag: "McpHeaderDuplicate",
      server: first.server,
      header: first.header,
      keys: Set(clash.map((b) => b.key)).toArray(),
    })
  }

  return Right(undefined)
}

/** Check every `mcp` binding in a config. Used by `envpkt validate` and the write gate. */
export const validateMcpHeaders = (config: EnvpktConfig): Either<McpConfigError, void> =>
  validateBindings(collectBindings(config))

/**
 * Build the HTTP header object for one MCP server: every secret whose `mcp` list names
 * `server`, merged into one object. `values` is keyed by logical secret name (as in
 * `BootResult.secrets`), so namespaces and aliases are already resolved by the caller.
 * Only this server's bindings are checked, so a problem on another server never blocks it.
 */
export const buildMcpHeaders = (
  config: EnvpktConfig,
  values: Readonly<Record<string, string>>,
  server: string,
): Either<McpHeadersError, Record<string, string>> => {
  const matches = collectBindings(config).filter((b) => b.server === server)
  if (matches.length === 0) return Left({ _tag: "McpServerUnknown", server })

  return validateBindings(matches).flatMap((): Either<McpHeadersError, Record<string, string>> => {
    // An empty value is treated as unresolved: sending "Bearer " would only earn a 401.
    const unresolved = matches.filter((b) => !values[b.key]).map((b) => b.key)
    if (unresolved.length > 0) return Left({ _tag: "McpValueUnresolved", server, keys: unresolved })

    const unsafe = matches.filter((b) => UNSAFE_VALUE_RE.test(values[b.key]!)).map((b) => b.key)
    if (unsafe.length > 0) return Left({ _tag: "McpValueInvalid", server, keys: unsafe })

    return Right(
      Object.fromEntries(
        matches.map((b) => {
          const value = values[b.key]!
          return [b.header, b.scheme === "" ? value : `${b.scheme} ${value}`]
        }),
      ),
    )
  })
}

/** Human-readable one-liner for any McpHeadersError tag. Never includes a secret value. */
export const formatMcpHeadersError = (error: McpHeadersError): string => {
  switch (error._tag) {
    case "McpHeaderInvalid":
      return `[secret.${error.key}] mcp server "${error.server}": header "${error.header}" is not a valid HTTP header name`
    case "McpSchemeInvalid":
      return `[secret.${error.key}] mcp server "${error.server}": scheme "${error.scheme}" must be a single word or ""`
    case "McpHeaderDuplicate":
      return `MCP server "${error.server}": header "${error.header}" is claimed by more than one binding: ${error.keys.join(", ")}`
    case "McpServerUnknown":
      return `No secret declares mcp server "${error.server}"`
    case "McpValueUnresolved":
      return `MCP server "${error.server}": no value resolved for ${error.keys.join(", ")}`
    case "McpValueInvalid":
      return `MCP server "${error.server}": value of ${error.keys.join(", ")} contains a line break or NUL and cannot be sent as a header`
  }
}
