import { readFileSync } from "node:fs"
import { dirname } from "node:path"

import { type Either, Option } from "functype"

import { describeSealKeySearch, resolveSealIdentity } from "../../core/boot.js"
import { loadConfig, resolveConfigPath } from "../../core/config.js"
import { copyableSecretMeta, serializeEnvBlock, serializeSecretBlock } from "../../core/copy.js"
import { ageEncrypt, unsealSecrets } from "../../core/seal.js"
import { appendSection, removeSection } from "../../core/toml-edit.js"
import type { EnvpktConfig } from "../../core/types.js"
import { BOLD, CYAN, DIM, formatError, GREEN, RED, RESET, YELLOW } from "../output.js"
import { previewIfValid, writeIfValid } from "../write-gate.js"

type CopyOptions = {
  readonly from?: string
  readonly to?: string
  readonly as?: string
  readonly force?: boolean
  readonly dryRun?: boolean
}

/** Unwrap an Either, or print the formatted error and exit with `code`. */
const orExit = <E, A>(e: Either<E, A>, onErr: (err: E) => string, code: number): A =>
  e.fold(
    (err) => {
      console.error(onErr(err))
      return process.exit(code)
    },
    (a) => a,
  )

const todayIso = (): string => new Date().toISOString().split("T")[0]!

/**
 * Build the `[secret.<destName>]` block for a copy: unseal the source value with the
 * source identity and reseal it for the destination recipient. Secrets with no sealed
 * value are copied as metadata only (with a warning) — there's nothing to reseal.
 */
const sealedSecretBlock = (
  key: string,
  destName: string,
  srcConfig: EnvpktConfig,
  srcPath: string,
  destConfig: EnvpktConfig,
): string => {
  const meta = srcConfig.secret![key]!
  const today = todayIso()

  if (meta.encrypted_value === undefined || meta.encrypted_value === "") {
    console.error(`${YELLOW}Warning:${RESET} secret "${key}" has no sealed value — copying metadata only.`)
    return serializeSecretBlock(destName, copyableSecretMeta(meta, { today, encryptedValue: Option.none<string>() }))
  }

  const identity = resolveSealIdentity(srcConfig, dirname(srcPath)).fold(
    () => {
      console.error(`${RED}Error:${RESET} cannot unseal "${key}" from source — no age key found.`)
      describeSealKeySearch(srcConfig, dirname(srcPath)).forEach((line) => console.error(`${DIM}  ${line}${RESET}`))
      return process.exit(2)
    },
    (id) => id,
  )

  const recipient = destConfig.identity?.recipient
  if (recipient === undefined) {
    identity.dispose()
    console.error(`${RED}Error:${RESET} destination needs identity.recipient to reseal "${destName}".`)
    console.error(`${DIM}  Run ${CYAN}envpkt keygen${DIM} in the destination, or add an [identity] recipient.${RESET}`)
    return process.exit(1)
  }

  // unsealSecrets returns Either (never throws), so disposing the temp key right after
  // is safe and clears it before the value is resealed/written.
  const unsealed = unsealSecrets({ [key]: meta }, identity.path)
  identity.dispose()
  const values = orExit(unsealed, (err) => `${RED}Error:${RESET} decrypt failed for "${key}": ${err.message}`, 2)
  const plaintext = values[key]
  if (plaintext === undefined) {
    console.error(`${RED}Error:${RESET} "${key}" produced no plaintext on unseal.`)
    return process.exit(2)
  }

  const cipher = orExit(
    ageEncrypt(plaintext, recipient),
    (err) => `${RED}Error:${RESET} reseal failed for "${destName}": ${err.message}`,
    2,
  )
  return serializeSecretBlock(destName, copyableSecretMeta(meta, { today, encryptedValue: Option(cipher) }))
}

const writeBlock = (
  destPath: string,
  header: string,
  block: string,
  overwrite: boolean,
  dryRun: boolean,
  successMsg: string,
): void => {
  const raw = readFileSync(destPath, "utf-8")
  const baseRaw = overwrite
    ? orExit(removeSection(raw, header), (err) => `${RED}Error:${RESET} ${err._tag}: ${err.section}`, 2)
    : raw
  const updated = appendSection(baseRaw, block)
  if (dryRun) {
    previewIfValid(updated, block)
    return
  }
  writeIfValid(destPath, updated, successMsg)
}

/**
 * Copy a secret or env entry from one config to another. Secrets are unsealed with the
 * source's age key and resealed for the destination's recipient automatically. The kind
 * (secret vs env) is detected from where the key lives in the source. `--from`/`--to`
 * default to the resolved config for the current directory.
 */
export const runCopy = (key: string, options: CopyOptions): void => {
  const src = orExit(resolveConfigPath(options.from), formatError, 2)
  const dest = orExit(resolveConfigPath(options.to), formatError, 2)
  const srcConfig = orExit(loadConfig(src.path), formatError, 2)
  const destConfig = orExit(loadConfig(dest.path), formatError, 2)
  console.error(`${DIM}copy: ${src.path} → ${dest.path}${RESET}`)

  const inSecret = srcConfig.secret?.[key] !== undefined
  const inEnv = srcConfig.env?.[key] !== undefined
  if (inSecret && inEnv) {
    console.error(
      `${RED}Error:${RESET} "${key}" exists as both a secret and an env entry in ${src.path}; copy them separately.`,
    )
    process.exit(1)
  }
  if (!inSecret && !inEnv) {
    console.error(`${RED}Error:${RESET} "${key}" not found in ${src.path}`)
    process.exit(1)
  }

  const destName = options.as ?? key
  const kindWord = inSecret ? "secret" : "env"

  if (src.path === dest.path && destName === key) {
    console.error(`${RED}Error:${RESET} source and destination are the same entry — use --as to copy under a new name.`)
    process.exit(1)
  }

  const existsInDest = inSecret ? destConfig.secret?.[destName] !== undefined : destConfig.env?.[destName] !== undefined
  if (existsInDest && options.force !== true) {
    console.error(
      `${RED}Error:${RESET} ${kindWord} "${destName}" already exists in ${dest.path}. Use --force to overwrite.`,
    )
    process.exit(1)
  }

  const block = inSecret
    ? sealedSecretBlock(key, destName, srcConfig, src.path, destConfig)
    : serializeEnvBlock(destName, srcConfig.env![key]!)

  const renamed = destName !== key ? ` → ${BOLD}${destName}${RESET}` : ""
  const successMsg = `${GREEN}✓${RESET} Copied ${kindWord} ${BOLD}${key}${RESET}${renamed} to ${CYAN}${dest.path}${RESET}`
  writeBlock(dest.path, `[${kindWord}.${destName}]`, block, existsInDest, options.dryRun === true, successMsg)
}
