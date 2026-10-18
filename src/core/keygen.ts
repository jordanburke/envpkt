import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { type Either, Left, None, type Option, Right, Some, Try } from "functype"

import { generateAgeKeypair } from "./age.js"
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

/** Update identity fields (recipient, key_file, name) in an envpkt.toml file, preserving structure */
export const updateConfigIdentity = (configPath: string, options: UpdateIdentityOptions): Either<KeygenError, true> => {
  const readResult = Try(() => readFileSync(configPath, "utf-8"))

  const fieldUpdaters: ReadonlyArray<{ readonly re: RegExp; readonly line: string }> = [
    { re: /^recipient\s*=/, line: `recipient = "${options.recipient}"` },
    ...(options.name ? [{ re: /^name\s*=/, line: `name = "${options.name}"` }] : []),
    ...(options.keyFile ? [{ re: /^key_file\s*=/, line: `key_file = "${options.keyFile}"` }] : []),
  ]

  return readResult.fold<Either<KeygenError, true>>(
    (err) => Left({ _tag: "ConfigUpdateError", message: `Failed to read config: ${err}` } as const),
    (raw) => {
      const lines = raw.split("\n")
      const updatedFields = new Set<string>()

      const acc = lines.reduce(
        (state, line) => {
          if (/^\[identity\]\s*$/.test(line)) {
            return { ...state, output: [...state.output, line], inIdentitySection: true, hasIdentitySection: true }
          }

          if (/^\[/.test(line) && !/^\[identity\]\s*$/.test(line)) {
            // Leaving [identity] — insert any fields not yet written
            const missing = state.inIdentitySection
              ? fieldUpdaters.filter((f) => !updatedFields.has(f.re.source)).map((f) => f.line)
              : []
            missing.forEach((l) => updatedFields.add(l))
            return {
              ...state,
              output: [...state.output, ...missing, line],
              inIdentitySection: false,
            }
          }

          if (state.inIdentitySection) {
            const match = fieldUpdaters.find((f) => f.re.test(line))
            if (match) {
              updatedFields.add(match.re.source)
              return { ...state, output: [...state.output, match.line] }
            }
          }

          return { ...state, output: [...state.output, line] }
        },
        { output: [] as string[], inIdentitySection: false, hasIdentitySection: false },
      )

      // Still in [identity] at EOF — insert any missing fields
      const missingAtEof = acc.inIdentitySection
        ? fieldUpdaters.filter((f) => !updatedFields.has(f.re.source)).map((f) => f.line)
        : []
      const afterEof = [...acc.output, ...missingAtEof]

      // No [identity] section at all — append one with all fields
      const identityLines = fieldUpdaters.map((f) => f.line)
      const output = !acc.hasIdentitySection ? [...afterEof, "", "[identity]", ...identityLines] : afterEof

      const writeResult = Try(() => writeFileSync(configPath, output.join("\n")))
      return writeResult.fold<Either<KeygenError, true>>(
        (err) => Left({ _tag: "ConfigUpdateError", message: `Failed to write config: ${err}` } as const),
        () => Right(true as const),
      )
    },
  )
}
