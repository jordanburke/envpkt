import type { Option } from "functype"

import type { EnvMeta, SecretMeta } from "./types.js"

/** Escape a string for a TOML basic (double-quoted) string. */
const tomlString = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`

const tomlStringArray = (arr: ReadonlyArray<string>): string => `[${arr.map(tomlString).join(", ")}]`

const tomlInlineTable = (rec: Readonly<Record<string, string>>): string => {
  const entries = Object.entries(rec)
  return entries.length === 0 ? "{}" : `{ ${entries.map(([k, v]) => `${k} = ${tomlString(v)}`).join(", ")} }`
}

/**
 * The SecretMeta to write into the destination on copy.
 * - `created` comes from the caller, never the source: today for an entry new to the
 *   destination, or the destination's own `created` when the copy overwrites it.
 * - `last_rotated_at` is dropped — it's the source's rotation history, not the copy's.
 * - `encryptedValue` re-derives the ciphertext: `Some(cipher)` sets the resealed value,
 *   `None` strips it entirely (a metadata-only copy of a secret with no sealed value).
 */
export const copyableSecretMeta = (
  meta: SecretMeta,
  opts: { readonly created: string; readonly encryptedValue: Option<string> },
): SecretMeta => {
  const { last_rotated_at: _lra, encrypted_value: _ev, ...rest } = meta
  return opts.encryptedValue.fold<SecretMeta>(
    () => ({ ...rest, created: opts.created }),
    (cipher) => ({ ...rest, created: opts.created, encrypted_value: cipher }),
  )
}

/** Serialize a `[secret.<name>]` block from its metadata, round-trippable by the TOML parser. */
export const serializeSecretBlock = (name: string, meta: SecretMeta): string => {
  const lines: ReadonlyArray<string> = [
    `[secret.${name}]`,
    ...(meta.service !== undefined ? [`service = ${tomlString(meta.service)}`] : []),
    ...(meta.purpose !== undefined ? [`purpose = ${tomlString(meta.purpose)}`] : []),
    ...(meta.comment !== undefined ? [`comment = ${tomlString(meta.comment)}`] : []),
    ...(meta.created !== undefined ? [`created = ${tomlString(meta.created)}`] : []),
    ...(meta.expires !== undefined ? [`expires = ${tomlString(meta.expires)}`] : []),
    ...(meta.rotates !== undefined ? [`rotates = ${tomlString(meta.rotates)}`] : []),
    ...(meta.rate_limit !== undefined ? [`rate_limit = ${tomlString(meta.rate_limit)}`] : []),
    ...(meta.model_hint !== undefined ? [`model_hint = ${tomlString(meta.model_hint)}`] : []),
    ...(meta.source !== undefined ? [`source = ${tomlString(meta.source)}`] : []),
    ...(meta.rotation_url !== undefined ? [`rotation_url = ${tomlString(meta.rotation_url)}`] : []),
    ...(meta.last_rotated_at !== undefined ? [`last_rotated_at = ${tomlString(meta.last_rotated_at)}`] : []),
    ...(meta.required !== undefined ? [`required = ${meta.required ? "true" : "false"}`] : []),
    ...(meta.capabilities !== undefined ? [`capabilities = ${tomlStringArray(meta.capabilities)}`] : []),
    ...(meta.tags !== undefined ? [`tags = ${tomlInlineTable(meta.tags)}`] : []),
    ...(meta.namespace !== undefined ? [`namespace = ${tomlString(meta.namespace)}`] : []),
    ...(meta.from_key !== undefined ? [`from_key = ${tomlString(meta.from_key)}`] : []),
    ...(meta.encrypted_value !== undefined && meta.encrypted_value !== ""
      ? [`encrypted_value = """`, meta.encrypted_value, `"""`]
      : []),
  ]
  return `${lines.join("\n")}\n`
}

/** Serialize an `[env.<name>]` block from its metadata. */
export const serializeEnvBlock = (name: string, meta: EnvMeta): string => {
  const lines: ReadonlyArray<string> = [
    `[env.${name}]`,
    ...(meta.value !== undefined ? [`value = ${tomlString(meta.value)}`] : []),
    ...(meta.from_key !== undefined ? [`from_key = ${tomlString(meta.from_key)}`] : []),
    ...(meta.purpose !== undefined ? [`purpose = ${tomlString(meta.purpose)}`] : []),
    ...(meta.comment !== undefined ? [`comment = ${tomlString(meta.comment)}`] : []),
    ...(meta.tags !== undefined ? [`tags = ${tomlInlineTable(meta.tags)}`] : []),
    ...(meta.namespace !== undefined ? [`namespace = ${tomlString(meta.namespace)}`] : []),
  ]
  return `${lines.join("\n")}\n`
}
