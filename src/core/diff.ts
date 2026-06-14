/* eslint-disable functype/prefer-option, functype/prefer-fold -- ConfigDiff is a JSON-serializable DTO (round-trips through `diff --format json`); fields use `string | undefined` where undefined means "field absent on that side". Option has no place in the serialized shape. */
import type { EnvMeta, EnvpktConfig, SecretMeta } from "./schema.js"

/** A single field that differs between two entries. `undefined` means the field is absent on that side. */
export type FieldChange = {
  readonly field: string
  readonly a: string | undefined
  readonly b: string | undefined
}

/** An entry present in both configs whose metadata differs. */
export type ChangedEntry = {
  readonly key: string
  readonly changes: ReadonlyArray<FieldChange>
}

/** Diff of one keyed section (`[secret.*]` or `[env.*]`). Key lists are sorted. */
export type SectionDiff = {
  readonly onlyA: ReadonlyArray<string>
  readonly onlyB: ReadonlyArray<string>
  readonly changed: ReadonlyArray<ChangedEntry>
}

export type ConfigDiff = {
  readonly secret: SectionDiff
  readonly env: SectionDiff
  readonly identical: boolean
}

/** Normalize a metadata value to a comparable/displayable string (`undefined` = absent). */
const serialize = (value: unknown): string | undefined =>
  value === undefined ? undefined : typeof value === "string" ? value : JSON.stringify(value)

type Meta = SecretMeta | EnvMeta

/**
 * Field-level diff of two entries. `encrypted_value` is excluded from value comparison — the same
 * secret re-encrypts to different ciphertext, so diffing it is noise — but a change in *sealed
 * status* (present ↔ absent) is reported as a synthetic `sealed` field.
 */
const metaDiff = (a: Meta, b: Meta): ReadonlyArray<FieldChange> => {
  const ar = a as Record<string, unknown>
  const br = b as Record<string, unknown>

  const sealedChange: ReadonlyArray<FieldChange> =
    !!ar["encrypted_value"] === !!br["encrypted_value"]
      ? []
      : [{ field: "sealed", a: ar["encrypted_value"] ? "yes" : "no", b: br["encrypted_value"] ? "yes" : "no" }]

  const fieldKeys = [...Object.keys(ar), ...Object.keys(br)].filter(
    (k, i, arr) => k !== "encrypted_value" && arr.indexOf(k) === i,
  )

  const fieldChanges = fieldKeys.flatMap((field) => {
    const av = serialize(ar[field])
    const bv = serialize(br[field])
    return av === bv ? [] : [{ field, a: av, b: bv }]
  })

  return [...sealedChange, ...fieldChanges.sort((x, y) => x.field.localeCompare(y.field))]
}

const sectionDiff = (a: Readonly<Record<string, Meta>>, b: Readonly<Record<string, Meta>>): SectionDiff => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return {
    onlyA: aKeys.filter((k) => !(k in b)).sort(),
    onlyB: bKeys.filter((k) => !(k in a)).sort(),
    changed: aKeys
      .filter((k) => k in b)
      .sort()
      .flatMap((key) => {
        const changes = metaDiff(a[key]!, b[key]!)
        return changes.length === 0 ? [] : [{ key, changes }]
      }),
  }
}

const isEmpty = (s: SectionDiff): boolean => s.onlyA.length === 0 && s.onlyB.length === 0 && s.changed.length === 0

/** Compare two configs by their `[secret.*]` and `[env.*]` entries (metadata, not ciphertext). */
export const diffConfigs = (a: EnvpktConfig, b: EnvpktConfig): ConfigDiff => {
  const secret = sectionDiff(a.secret ?? {}, b.secret ?? {})
  const env = sectionDiff(a.env ?? {}, b.env ?? {})
  return { secret, env, identical: isEmpty(secret) && isEmpty(env) }
}
