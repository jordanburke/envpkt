import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { List, Option, Set } from "functype"

import { expandPath, loadConfig, resolveConfigPath } from "../../core/config.js"
import { resolveKeyPath } from "../../core/keygen.js"
import { resolveValues } from "../../core/resolve-values.js"
import { sealSecrets, unsealSecrets } from "../../core/seal.js"
import { unwrapAgentKey } from "../../fnox/identity.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RED, RESET, YELLOW } from "../output.js"

type SealOptions = {
  readonly config?: string
  readonly profile?: string
  readonly reseal?: boolean
  readonly edit?: string
}

type SealParseState = {
  readonly output: readonly string[]
  readonly currentMetaKey: Option<string>
  readonly insideMetaBlock: boolean
  readonly hasEncryptedValue: boolean
  readonly consumedKeys: Set<string>
  readonly skipUntil: number
}

const META_SECTION_RE = /^\[secret\.(.+)\]\s*$/
const ENCRYPTED_VALUE_RE = /^encrypted_value\s*=/
const NEW_SECTION_RE = /^\[/
const MULTILINE_DELIM = '"""'

/** Write sealed values back into the TOML file, preserving structure. */
const writeSealedToml = (configPath: string, sealedMeta: Record<string, { encrypted_value?: string }>): void => {
  const raw = readFileSync(configPath, "utf-8")
  const lines = raw.split("\n")

  const getSeal = (key: string): Option<string> => Option(sealedMeta[key]?.encrypted_value)

  const isPending = (state: SealParseState, key: string): boolean =>
    !getSeal(key).isEmpty && !state.consumedKeys.has(key)

  const sealLinesFor = (key: string): readonly string[] =>
    getSeal(key).fold<readonly string[]>(
      () => [],
      (v) => [`encrypted_value = """`, v, `"""`],
    )

  /** Append a seal block to `output` if the current section is pending and hasn't already got one. */
  const flushPending = (state: SealParseState): SealParseState =>
    state.currentMetaKey.fold(
      () => state,
      (key) => {
        if (state.hasEncryptedValue || !isPending(state, key)) return state
        return {
          ...state,
          output: [...state.output, ...sealLinesFor(key), ""],
          consumedKeys: state.consumedKeys.add(key),
        }
      },
    )

  const step = (state: SealParseState, line: string, i: number): SealParseState => {
    if (i <= state.skipUntil) return state

    const metaMatch = line.match(META_SECTION_RE)
    if (metaMatch) {
      const flushed = flushPending(state)
      return {
        ...flushed,
        output: [...flushed.output, line],
        currentMetaKey: Option(metaMatch[1]),
        insideMetaBlock: true,
        hasEncryptedValue: false,
      }
    }

    if (state.insideMetaBlock && NEW_SECTION_RE.test(line) && !META_SECTION_RE.test(line)) {
      const flushed = flushPending(state)
      return {
        ...flushed,
        output: [...flushed.output, line],
        insideMetaBlock: false,
        currentMetaKey: Option.none<string>(),
      }
    }

    if (state.insideMetaBlock && ENCRYPTED_VALUE_RE.test(line)) {
      const replacingKey = state.currentMetaKey.filter((k) => isPending(state, k))
      const replacement = replacingKey.fold<readonly string[]>(
        () => [line],
        (key) => sealLinesFor(key),
      )
      const consumedKeys = replacingKey.fold(
        () => state.consumedKeys,
        (key) => state.consumedKeys.add(key),
      )
      const replacing = !replacingKey.isEmpty

      const afterEquals = line.slice(line.indexOf("=") + 1).trim()
      if (!afterEquals.includes(MULTILINE_DELIM)) {
        return {
          ...state,
          output: [...state.output, ...replacement],
          hasEncryptedValue: true,
          consumedKeys,
        }
      }

      // Multiline opening: find closing """ and skip through it (keeping continuation if not replacing).
      const closingIdx = lines.findIndex((l, j) => j > i && l.includes(MULTILINE_DELIM))
      const effectiveEnd = closingIdx === -1 ? lines.length - 1 : closingIdx
      const continuation = replacing ? [] : lines.slice(i + 1, effectiveEnd + 1)

      return {
        ...state,
        output: [...state.output, ...replacement, ...continuation],
        hasEncryptedValue: true,
        consumedKeys,
        skipUntil: effectiveEnd,
      }
    }

    return { ...state, output: [...state.output, line] }
  }

  const initial: SealParseState = {
    output: [],
    currentMetaKey: Option.none<string>(),
    insideMetaBlock: false,
    hasEncryptedValue: false,
    consumedKeys: Set.empty<string>(),
    skipUntil: -1,
  }

  const walked = List(lines).zipWithIndex().foldLeft<SealParseState>(initial)((state, entry) =>
    step(state, entry[0], entry[1]),
  )

  // Final flush for the last section (if it ended without an encrypted_value line).
  const final = flushPending(walked)

  writeFileSync(configPath, final.output.join("\n"))
}

export const runSeal = async (options: SealOptions): Promise<void> => {
  const configResult = resolveConfigPath(options.config)

  const { path: configPath, source: configSource } = configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
      return { path: "", source: "flag" as const } // unreachable
    },
    (r) => r,
  )
  const sourceMsg = formatConfigSource(configPath, configSource)
  if (sourceMsg) console.error(sourceMsg)

  const config = loadConfig(configPath).fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
      return undefined! // unreachable
    },
    (c) => c,
  )

  // Verify identity.recipient exists
  if (!config.identity?.recipient) {
    console.error(`${RED}Error:${RESET} identity.recipient is required for sealing (age public key)`)
    console.error("")
    console.error(
      `${BOLD}Quick fix:${RESET} run ${CYAN}envpkt keygen${RESET} to generate a key and auto-configure recipient`,
    )
    console.error(`${DIM}Or manually add to your envpkt.toml:${RESET}`)
    console.error(`${DIM}  [identity]${RESET}`)
    console.error(`${DIM}  recipient = "age1..."${RESET}`)
    process.exit(2)
  }

  const { recipient } = config.identity
  const configDir = dirname(configPath)

  // Guard: refuse to seal keys that exist in [env.*]
  const envEntries = config.env ?? {}
  const secretEntries0 = config.secret ?? {}
  const envConflicts = Object.keys(secretEntries0).filter((k) => k in envEntries)
  if (envConflicts.length > 0) {
    console.error(`${RED}Error:${RESET} Cannot seal keys that are also defined in [env.*]: ${envConflicts.join(", ")}`)
    console.error(`${DIM}Move these to [secret.*] only, or remove from [env.*] before sealing.${RESET}`)
    process.exit(2)
  }

  // Resolve identity key if key_file is configured
  const identityKey: Option<string> = Option(config.identity.key_file).flatMap((keyFile) => {
    const identityPath = resolve(configDir, expandPath(keyFile))
    return unwrapAgentKey(identityPath).fold(
      (err) => {
        const msg = err._tag === "IdentityNotFound" ? `not found: ${err.path}` : err.message
        console.error(`${YELLOW}Warning:${RESET} Could not unwrap agent key: ${msg}`)
        return Option.none<string>()
      },
      (k) => Option(k),
    )
  })

  // --edit mode: re-seal specific keys with new interactively-prompted values
  const editKeys = options.edit
    ? options.edit
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : []

  if (editKeys.length > 0) {
    const allSecretEntries = config.secret ?? {}
    const unknownKeys = editKeys.filter((k) => !(k in allSecretEntries))
    if (unknownKeys.length > 0) {
      console.error(`${RED}Error:${RESET} Unknown secret key(s): ${unknownKeys.join(", ")}`)
      console.error(`${DIM}Available keys: ${Object.keys(allSecretEntries).join(", ")}${RESET}`)
      process.exit(2)
    }

    if (!process.stdin.isTTY) {
      console.error(`${RED}Error:${RESET} --edit requires an interactive terminal`)
      process.exit(2)
    }

    // eslint-disable-next-line functype/prefer-flatmap -- Object.fromEntries requires tuple mapping, not flatMap
    const secretEntries = Object.fromEntries(editKeys.map((k) => [k, allSecretEntries[k]!]))

    console.log(
      `${BOLD}Editing ${editKeys.length} secret(s)${RESET} with recipient ${CYAN}${recipient.slice(0, 20)}...${RESET}`,
    )
    console.log("")

    // Force interactive prompt — skip fnox/env cascade entirely
    const rl = await import("node:readline").then((m) =>
      m.createInterface({ input: process.stdin, output: process.stderr }),
    )
    const prompt = (question: string): Promise<string> =>
      new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer))
      })

    const values: Record<string, string> = {}
    // eslint-disable-next-line functype/no-imperative-loops -- sequential await required for interactive prompts
    for (const key of editKeys) {
      const value = await prompt(`Enter new value for ${key}: `)
      if (value === "") {
        console.error(`${YELLOW}Skipped${RESET} ${key} (empty value)`)
        continue
      }
      values[key] = value
    }
    rl.close()

    if (Object.keys(values).length === 0) {
      console.error(`${RED}Error:${RESET} No values provided`)
      process.exit(2)
    }

    const sealResult = sealSecrets(secretEntries, values, recipient)
    sealResult.fold(
      (err) => {
        console.error(`${RED}Error:${RESET} Seal failed: ${err.message}`)
        process.exit(2)
      },
      (sealedMeta) => {
        writeSealedToml(configPath, sealedMeta)
        console.log(`${GREEN}Sealed${RESET} ${Object.keys(values).length} secret(s) into ${DIM}${configPath}${RESET}`)
      },
    )
    return
  }

  // Partition secrets into already-sealed and unsealed
  const allSecretEntries = config.secret ?? {}
  const allKeys = Object.keys(allSecretEntries)
  const alreadySealed = allKeys.filter((k) => allSecretEntries[k]!.encrypted_value)
  const unsealed = allKeys.filter((k) => !allSecretEntries[k]!.encrypted_value)

  // Skip already-sealed unless --reseal
  if (!options.reseal && alreadySealed.length > 0) {
    if (unsealed.length === 0) {
      console.log(
        `${GREEN}✓${RESET} All ${BOLD}${alreadySealed.length}${RESET} secret(s) already sealed. Use ${CYAN}--reseal${RESET} to re-encrypt.`,
      )
      process.exit(0)
    }
    console.log(
      `${DIM}Skipping ${alreadySealed.length} already-sealed secret(s). Use --reseal to re-encrypt all.${RESET}`,
    )
  }

  const targetKeys = options.reseal ? allKeys : unsealed
  // eslint-disable-next-line functype/prefer-flatmap -- Object.fromEntries requires tuple mapping
  const secretEntries = Object.fromEntries(targetKeys.map((k) => [k, allSecretEntries[k]!]))

  // Resolve values via cascade
  const metaKeys = targetKeys
  console.log(
    `${BOLD}Sealing ${metaKeys.length} secret(s)${RESET} with recipient ${CYAN}${recipient.slice(0, 20)}...${RESET}`,
  )
  console.log("")

  // When resealing, decrypt existing sealed values first, then only resolve NEW keys
  const values = await (async (): Promise<Record<string, string>> => {
    if (options.reseal && alreadySealed.length > 0) {
      const identityPath = config.identity?.key_file
        ? resolve(configDir, expandPath(config.identity.key_file))
        : (() => {
            const defaultPath = resolveKeyPath()
            return existsSync(defaultPath) ? defaultPath : undefined
          })()

      if (!identityPath) {
        console.error(`${RED}Error:${RESET} No identity key found for --reseal (needed to decrypt existing secrets)`)
        console.error("")
        console.error(`${DIM}Looked in:${RESET}`)
        console.error(`${DIM}  1. identity.key_file in envpkt.toml${RESET}`)
        console.error(`${DIM}  2. ENVPKT_AGE_KEY_FILE env var${RESET}`)
        console.error(`${DIM}  3. ~/.envpkt/age-key.txt${RESET}`)
        process.exit(2)
      }

      // eslint-disable-next-line functype/prefer-flatmap -- Object.fromEntries requires tuple mapping
      const sealedEntries = Object.fromEntries(alreadySealed.map((k) => [k, allSecretEntries[k]!]))
      const decrypted = unsealSecrets(sealedEntries, identityPath).fold(
        (err) => {
          console.error(`${RED}Error:${RESET} Failed to decrypt existing secrets: ${err.message}`)
          process.exit(2)
          return {} as Record<string, string> // unreachable
        },
        (d) => d,
      )

      // Only resolve values for keys that weren't already sealed
      const newValues =
        unsealed.length > 0 ? await resolveValues(unsealed, options.profile, identityKey.orUndefined()) : {}

      // Merge: decrypted existing values + newly resolved values (new values override if present)
      return { ...decrypted, ...newValues }
    }
    return resolveValues(metaKeys, options.profile, identityKey.orUndefined())
  })()

  const resolved = Object.keys(values).length
  const skipped = metaKeys.length - resolved
  if (resolved === 0) {
    console.error(`${RED}Error:${RESET} No values resolved for any secret key`)
    process.exit(2)
  }

  if (skipped > 0) {
    const skippedKeys = metaKeys.filter((k) => !(k in values))
    console.log(`${YELLOW}Skipped${RESET} ${skipped} key(s) with no value: ${skippedKeys.join(", ")}`)
  }

  // Encrypt
  const sealResult = sealSecrets(secretEntries, values, recipient)

  sealResult.fold(
    (err) => {
      console.error(`${RED}Error:${RESET} Seal failed: ${err.message}`)
      process.exit(2)
    },
    (sealedMeta) => {
      writeSealedToml(configPath, sealedMeta)
      const sealedCount = resolved
      const prevSealed = options.reseal ? 0 : alreadySealed.length
      const summary = prevSealed > 0 ? ` (${prevSealed} previously sealed kept)` : ""
      console.log(`${GREEN}Sealed${RESET} ${sealedCount} secret(s) into ${DIM}${configPath}${RESET}${summary}`)
    },
  )
}
