import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { type Either, Left, None, type Option, Right, Some, Try } from "functype"

import { ageAvailable } from "../fnox/identity.js"
import type { KeygenError, KeygenResult } from "./types.js"

/** Resolve the age identity file path: ENVPKT_AGE_KEY_FILE env var > ~/.envpkt/age-key.txt */
export const resolveKeyPath = (): string =>
  process.env["ENVPKT_AGE_KEY_FILE"] ?? join(homedir(), ".envpkt", "age-key.txt")

/** Resolve an inline age key from ENVPKT_AGE_KEY env var (for CI) */
export const resolveInlineKey = (): Option<string> => {
  const key = process.env["ENVPKT_AGE_KEY"]
  return key ? Some(key) : None()
}

/** Generate an age keypair and write to disk */
export const generateKeypair = (options?: {
  readonly force?: boolean
  readonly outputPath?: string
}): Either<KeygenError, KeygenResult> => {
  if (!ageAvailable()) {
    return Left({
      _tag: "AgeNotFound",
      message: "age-keygen CLI not found on PATH. Install age: https://github.com/FiloSottile/age",
    } as const)
  }

  const outputPath = options?.outputPath ?? resolveKeyPath()

  if (existsSync(outputPath) && !options?.force) {
    return Left({ _tag: "KeyExists", path: outputPath } as const)
  }

  const keygenResult = Try(() =>
    execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }),
  )

  // eslint-disable-next-line functype/prefer-do-notation -- functype does not provide Either.Do notation
  return keygenResult.fold<Either<KeygenError, KeygenResult>>(
    (err) => Left({ _tag: "KeygenFailed", message: `age-keygen failed: ${err}` } as const),
    (output) => {
      // Parse recipient from keygen output: "# public key: age1..."
      const recipientLine = output.split("\n").find((l) => l.startsWith("# public key:"))
      if (!recipientLine) {
        return Left({ _tag: "KeygenFailed", message: "Could not parse public key from age-keygen output" } as const)
      }
      const recipient = recipientLine.replace("# public key: ", "").trim()

      // Ensure parent directory exists
      const dir = dirname(outputPath)
      const mkdirResult = Try(() => {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
      })

      const mkdirFailed = mkdirResult.fold(
        (err) => ({ _tag: "WriteError" as const, message: `Failed to create directory ${dir}: ${err}` }),
        () => undefined,
      )
      if (mkdirFailed) return Left(mkdirFailed)

      // Write identity file
      const writeResult = Try(() => {
        writeFileSync(outputPath, output, { mode: 0o600 })
        chmodSync(outputPath, 0o600)
      })

      return writeResult.fold<Either<KeygenError, KeygenResult>>(
        (err) => Left({ _tag: "WriteError", message: `Failed to write identity file: ${err}` } as const),
        (): Either<KeygenError, KeygenResult> =>
          Right({ recipient, identityPath: outputPath, configUpdated: false as boolean }),
      )
    },
  )
}

/** Update identity.recipient in an envpkt.toml file, preserving structure */
export const updateConfigRecipient = (configPath: string, recipient: string): Either<KeygenError, true> => {
  const readResult = Try(() => readFileSync(configPath, "utf-8"))

  // eslint-disable-next-line functype/prefer-do-notation -- functype does not provide Either.Do notation
  return readResult.fold<Either<KeygenError, true>>(
    (err) => Left({ _tag: "ConfigUpdateError", message: `Failed to read config: ${err}` } as const),
    (raw) => {
      const lines = raw.split("\n")

      const acc = lines.reduce(
        (state, line) => {
          // Detect [identity] section
          if (/^\[identity\]\s*$/.test(line)) {
            return { ...state, output: [...state.output, line], inIdentitySection: true, hasIdentitySection: true }
          }

          // Detect new section (leaving [identity])
          if (/^\[/.test(line) && !/^\[identity\]\s*$/.test(line)) {
            const inserted =
              state.inIdentitySection && !state.recipientUpdated
                ? [...state.output, `recipient = "${recipient}"`, line]
                : [...state.output, line]
            return {
              ...state,
              output: inserted,
              inIdentitySection: false,
              recipientUpdated: state.recipientUpdated || (state.inIdentitySection && !state.recipientUpdated),
            }
          }

          // Update existing recipient line
          if (state.inIdentitySection && /^recipient\s*=/.test(line)) {
            return { ...state, output: [...state.output, `recipient = "${recipient}"`], recipientUpdated: true }
          }

          return { ...state, output: [...state.output, line] }
        },
        { output: [] as string[], inIdentitySection: false, recipientUpdated: false, hasIdentitySection: false },
      )

      // If still in [identity] at EOF and didn't update
      const afterEof =
        acc.inIdentitySection && !acc.recipientUpdated ? [...acc.output, `recipient = "${recipient}"`] : acc.output

      // If no [identity] section at all, append one
      const output = !acc.hasIdentitySection ? [...afterEof, "", "[identity]", `recipient = "${recipient}"`] : afterEof

      const writeResult = Try(() => writeFileSync(configPath, output.join("\n")))
      return writeResult.fold<Either<KeygenError, true>>(
        (err) => Left({ _tag: "ConfigUpdateError", message: `Failed to write config: ${err}` } as const),
        () => Right(true as const),
      )
    },
  )
}
