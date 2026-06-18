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
 * - `created` is reset to today: the entry is new *here*, regardless of the source's age.
 * - `last_rotated_at` is dropped — it's the source's rotation history, not the copy's.
 * - `encryptedValue` re-derives the ciphertext: `Some(cipher)` sets the resealed value,
 *   `None` strips it entirely (a metadata-only copy of a secret with no sealed value).
 */
export const copyableSecretMeta = (
  meta: SecretMeta,
  opts: { readonly today: string; readonly encryptedValue: Option<string> },
): SecretMeta => {
  const { last_rotated_at: _lra, encrypted_value: _ev, ...rest } = meta
  return opts.encryptedValue.fold<SecretMeta>(
    () => ({ ...rest, created: opts.today }),
    (cipher) => ({ ...rest, created: opts.today, encrypted_value: cipher }),
  )
}

/** Serialize a `[secret.<name>]` block from its metadata, round-trippable by the TOML parser. */
export const serializeSecretBlock = (name: string, meta: SecretMeta): string => {
  const lines: string[] = [`[secret.${name}]`]
  if (meta.service !== undefined) lines.push(`service = ${tomlString(meta.service)}`)
  if (meta.purpose !== undefined) lines.push(`purpose = ${tomlString(meta.purpose)}`)
  if (meta.comment !== undefined) lines.push(`comment = ${tomlString(meta.comment)}`)
  if (meta.created !== undefined) lines.push(`created = ${tomlString(meta.created)}`)
  if (meta.expires !== undefined) lines.push(`expires = ${tomlString(meta.expires)}`)
  if (meta.rotates !== undefined) lines.push(`rotates = ${tomlString(meta.rotates)}`)
  if (meta.rate_limit !== undefined) lines.push(`rate_limit = ${tomlString(meta.rate_limit)}`)
  if (meta.model_hint !== undefined) lines.push(`model_hint = ${tomlString(meta.model_hint)}`)
  if (meta.source !== undefined) lines.push(`source = ${tomlString(meta.source)}`)
  if (meta.rotation_url !== undefined) lines.push(`rotation_url = ${tomlString(meta.rotation_url)}`)
  if (meta.last_rotated_at !== undefined) lines.push(`last_rotated_at = ${tomlString(meta.last_rotated_at)}`)
  if (meta.required !== undefined) lines.push(`required = ${meta.required ? "true" : "false"}`)
  if (meta.capabilities !== undefined) lines.push(`capabilities = ${tomlStringArray(meta.capabilities)}`)
  if (meta.tags !== undefined) lines.push(`tags = ${tomlInlineTable(meta.tags)}`)
  if (meta.namespace !== undefined) lines.push(`namespace = ${tomlString(meta.namespace)}`)
  if (meta.from_key !== undefined) lines.push(`from_key = ${tomlString(meta.from_key)}`)
  if (meta.encrypted_value !== undefined && meta.encrypted_value !== "") {
    lines.push(`encrypted_value = """`, meta.encrypted_value, `"""`)
  }
  return `${lines.join("\n")}\n`
}

/** Serialize an `[env.<name>]` block from its metadata. */
export const serializeEnvBlock = (name: string, meta: EnvMeta): string => {
  const lines: string[] = [`[env.${name}]`]
  if (meta.value !== undefined) lines.push(`value = ${tomlString(meta.value)}`)
  if (meta.from_key !== undefined) lines.push(`from_key = ${tomlString(meta.from_key)}`)
  if (meta.purpose !== undefined) lines.push(`purpose = ${tomlString(meta.purpose)}`)
  if (meta.comment !== undefined) lines.push(`comment = ${tomlString(meta.comment)}`)
  if (meta.tags !== undefined) lines.push(`tags = ${tomlInlineTable(meta.tags)}`)
  if (meta.namespace !== undefined) lines.push(`namespace = ${tomlString(meta.namespace)}`)
  return `${lines.join("\n")}\n`
}
