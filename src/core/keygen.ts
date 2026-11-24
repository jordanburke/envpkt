import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import { type Either, Left, None, type Option, Right, Some, Try } from "functype"
import { parse, stringify } from "smol-toml"

import { generateAgeKeypair } from "./age.js"
import { appendSection, updateSectionFields } from "./toml-edit.js"
import type { KeygenError, KeygenResult } from "./types.js"

/** Resolve the age identity file path: ENVPKT_AGE_KEY_FILE env var > ~/.envpkt/age-key.txt */
export const resolveKeyPath = (): string =>
  process.env["ENVPKT_AGE_KEY_FILE"] ?? join(homedir(), ".envpkt", "age-key.txt")

/** Resolve an inline age key from ENVPKT_AGE_KEY env var (for CI) */
export const resolveInlineKey = (): Option<string> => {
  const key = process.env["ENVPKT_AGE_KEY"]
  return key ? Some(key) : None()
}

/** The identity file `age-keygen` writes: creation time, public key, secret key. */
export const identityFileContent = (identity: string, recipient: string): string =>
  `# created: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}\n# public key: ${recipient}\n${identity}\n`

/** Write the identity file (0600), creating its directory if needed. Never overwrites a file. */
const writeIdentityFile = (outputPath: string, content: string): Either<KeygenError, void> =>
  Try(() => {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, content, { mode: 0o600, flag: "wx" })
    chmodSync(outputPath, 0o600)
  }).fold<Either<KeygenError, void>>(
    (err) => Left({ _tag: "WriteError", message: `Failed to write identity file: ${err}` }),
    () => Right(undefined),
  )

/** Generate an age keypair and write to disk. Refuses to overwrite if the file already exists. */
export const generateKeypair = async (options?: {
  readonly outputPath?: string
}): Promise<Either<KeygenError, KeygenResult>> => {
  const outputPath = options?.outputPath ?? resolveKeyPath()

  if (existsSync(outputPath)) {
    return Left({ _tag: "KeyExists", path: outputPath } as const)
  }

  return (await generateAgeKeypair()).flatMap(({ identity, recipient }) =>
    writeIdentityFile(outputPath, identityFileContent(identity, recipient)).map((): KeygenResult => ({
      recipient,
      identityPath: outputPath,
      configUpdated: false,
    })),
  )
}

type UpdateIdentityOptions = {
  readonly recipient: string
  readonly keyFile?: string
  readonly name?: string
}

type IdentityFields = Readonly<Record<string, string>>

/** The `[identity]` fields keygen sets, in the order it writes new ones. */
const identityFields = (options: UpdateIdentityOptions): IdentityFields => ({
  recipient: options.recipient,
  ...(options.name ? { name: options.name } : {}),
  ...(options.keyFile ? { key_file: options.keyFile } : {}),
})

/** A TOML string literal for `value`, escaped by smol-toml. */
const tomlString = (value: string): string => stringify({ v: value }).trimEnd().slice("v = ".length)

/** The `[identity]` table for these options, as escaped TOML: what keygen tells the user to add when it can't edit the file. */
export const identityTomlBlock = (options: UpdateIdentityOptions): string =>
  stringify({ identity: identityFields(options) })

const configUpdateError = (message: string): Either<KeygenError, never> =>
  Left({ _tag: "ConfigUpdateError", message } as const)

const parseTomlDoc = (raw: string): Either<string, Readonly<Record<string, unknown>>> =>
  Try(() => parse(raw)).fold<Either<string, Readonly<Record<string, unknown>>>>(
    (err) => Left(err.message),
    (doc) => Right(doc),
  )

const isTable = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Set identity fields in raw envpkt.toml text. Edits the `[identity]` table in place, or appends one.
 * The result must parse to the original document with only those fields changed; anything else
 * (a layout the text editor can't follow) is refused rather than written.
 */
const setIdentityFields = (raw: string, fields: IdentityFields): Either<KeygenError, string> => {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n"
  const text = raw.replaceAll("\r\n", "\n")

  return parseTomlDoc(raw).fold<Either<KeygenError, string>>(
    (message) => configUpdateError(`envpkt.toml does not parse, so it was left unchanged: ${message}`),
    (original) => {
      const existing = original["identity"]
      const expected = { ...original, identity: { ...(isTable(existing) ? existing : {}), ...fields } }
      const quoted = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, tomlString(value)]))

      const edited = updateSectionFields(text, "[identity]", quoted).fold(
        () => appendSection(text, stringify({ identity: fields })),
        (updated) => updated,
      )
      const result = `${edited.trimEnd()}\n`.replaceAll("\n", eol)

      const matches = parseTomlDoc(result).fold(
        () => false,
        // smol-toml builds null-prototype tables and TomlDate values; cloning both sides compares data alone.
        (doc) => isDeepStrictEqual(structuredClone(doc), structuredClone(expected)),
      )
      return matches
        ? Right(result)
        : configUpdateError(
            "envpkt.toml lays out [identity] in a way keygen can't edit safely, so it was left unchanged",
          )
    },
  )
}

/** Update identity fields (recipient, key_file, name) in an envpkt.toml file, preserving structure */
export const updateConfigIdentity = (configPath: string, options: UpdateIdentityOptions): Either<KeygenError, true> =>
  Try(() => readFileSync(configPath, "utf-8"))
    .fold<Either<KeygenError, string>>(
      (err) => configUpdateError(`Failed to read config: ${err}`),
      (raw) => setIdentityFields(raw, identityFields(options)),
    )
    .flatMap((updated) =>
      Try(() => writeFileSync(configPath, updated)).fold<Either<KeygenError, true>>(
        (err) => configUpdateError(`Failed to write config: ${err}`),
        () => Right(true as const),
      ),
    )
