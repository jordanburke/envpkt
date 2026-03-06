import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { expandPath, loadConfig, resolveConfigPath } from "../../core/config.js"
import { resolveValues } from "../../core/resolve-values.js"
import { sealSecrets } from "../../core/seal.js"
import { unwrapAgentKey } from "../../fnox/identity.js"
import { BOLD, CYAN, DIM, formatConfigSource, formatError, GREEN, RED, RESET, YELLOW } from "../output.js"

type SealOptions = {
  readonly config?: string
  readonly profile?: string
  readonly reseal?: boolean
}

/* eslint-disable functional/no-let -- stateful line-by-line TOML parser */
/** Write sealed values back into the TOML file, preserving structure */
const writeSealedToml = (configPath: string, sealedMeta: Record<string, { encrypted_value?: string }>): void => {
  const raw = readFileSync(configPath, "utf-8")
  const lines = raw.split("\n")
  const output: string[] = []

  let currentMetaKey: string | undefined
  let insideMetaBlock = false
  let hasEncryptedValue = false
  const pendingSeals = new Map<string, string>()

  // Collect all encrypted_value entries to write
  for (const [key, meta] of Object.entries(sealedMeta)) {
    if (meta.encrypted_value) {
      pendingSeals.set(key, meta.encrypted_value)
    }
  }

  const metaSectionRe = /^\[secret\.(.+)\]\s*$/
  const encryptedValueRe = /^encrypted_value\s*=/
  const newSectionRe = /^\[/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const metaMatch = metaSectionRe.exec(line)

    if (metaMatch) {
      // Flush pending encrypted_value for previous block if needed
      if (currentMetaKey && !hasEncryptedValue && pendingSeals.has(currentMetaKey)) {
        output.push(`encrypted_value = """`)
        output.push(pendingSeals.get(currentMetaKey)!)
        output.push(`"""`)
        pendingSeals.delete(currentMetaKey)
      }

      currentMetaKey = metaMatch[1]
      insideMetaBlock = true
      hasEncryptedValue = false
      output.push(line)
      continue
    }

    if (insideMetaBlock && newSectionRe.test(line) && !metaSectionRe.test(line)) {
      // Leaving meta block — flush if needed
      if (currentMetaKey && !hasEncryptedValue && pendingSeals.has(currentMetaKey)) {
        output.push(`encrypted_value = """`)
        output.push(pendingSeals.get(currentMetaKey)!)
        output.push(`"""`)
        pendingSeals.delete(currentMetaKey)
      }
      insideMetaBlock = false
      currentMetaKey = undefined
      output.push(line)
      continue
    }

    if (insideMetaBlock && encryptedValueRe.test(line)) {
      // Replace existing encrypted_value (skip until end of multiline string)
      hasEncryptedValue = true
      if (currentMetaKey && pendingSeals.has(currentMetaKey)) {
        output.push(`encrypted_value = """`)
        output.push(pendingSeals.get(currentMetaKey)!)
        output.push(`"""`)
        pendingSeals.delete(currentMetaKey)
        // Skip old multiline value
        if (line.includes('"""') && !line.endsWith('"""')) {
          // Single-line or start of multiline
          const afterEquals = line.slice(line.indexOf("=") + 1).trim()
          if (afterEquals.startsWith('"""') && !afterEquals.slice(3).includes('"""')) {
            // Skip until closing """
            while (i + 1 < lines.length && !lines[i + 1]!.includes('"""')) {
              i++
            }
            if (i + 1 < lines.length) i++ // skip the closing """
          }
        }
      } else {
        output.push(line)
      }
      continue
    }

    output.push(line)
  }

  // Flush the last meta block
  if (currentMetaKey && !hasEncryptedValue && pendingSeals.has(currentMetaKey)) {
    output.push(`encrypted_value = """`)
    output.push(pendingSeals.get(currentMetaKey)!)
    output.push(`"""`)
    pendingSeals.delete(currentMetaKey)
  }

  writeFileSync(configPath, output.join("\n"))
}
/* eslint-enable functional/no-let */

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

  // Verify agent.recipient exists
  if (!config.agent?.recipient) {
    console.error(`${RED}Error:${RESET} agent.recipient is required for sealing (age public key)`)
    console.error(`${DIM}Add [agent] section with recipient = "age1..." to your envpkt.toml${RESET}`)
    process.exit(2)
  }

  const { recipient } = config.agent
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

  // Resolve agent key if identity is configured
  const agentKey: string | undefined = config.agent.identity
    ? (() => {
        const identityPath = resolve(configDir, expandPath(config.agent.identity))
        return unwrapAgentKey(identityPath).fold(
          (err) => {
            const msg = err._tag === "IdentityNotFound" ? `not found: ${err.path}` : err.message
            console.error(`${YELLOW}Warning:${RESET} Could not unwrap agent key: ${msg}`)
            return undefined
          },
          (k) => k,
        )
      })()
    : undefined

  // Partition secrets into already-sealed and unsealed
  const allSecretEntries = config.secret ?? {}
  const allKeys = Object.keys(allSecretEntries)
  const alreadySealed = allKeys.filter((k) => allSecretEntries[k]?.encrypted_value)
  const unsealed = allKeys.filter((k) => !allSecretEntries[k]?.encrypted_value)

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
  const secretEntries = Object.fromEntries(targetKeys.map((k) => [k, allSecretEntries[k]!]))

  // Resolve values via cascade
  const metaKeys = targetKeys
  console.log(
    `${BOLD}Sealing ${metaKeys.length} secret(s)${RESET} with recipient ${CYAN}${recipient.slice(0, 20)}...${RESET}`,
  )
  console.log("")

  const values = await resolveValues(metaKeys, options.profile, agentKey)

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
