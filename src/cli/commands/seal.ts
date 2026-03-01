import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { expandPath, loadConfig, resolveConfigPath } from "../../core/config.js"
import { resolveValues } from "../../core/resolve-values.js"
import { sealSecrets } from "../../core/seal.js"
import { unwrapAgentKey } from "../../fnox/identity.js"
import { BOLD, CYAN, DIM, formatError, GREEN, RED, RESET, YELLOW } from "../output.js"

type SealOptions = {
  readonly config?: string
  readonly profile?: string
}

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

  const metaSectionRe = /^\[meta\.(.+)\]\s*$/
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

export const runSeal = async (options: SealOptions): Promise<void> => {
  const configResult = resolveConfigPath(options.config)

  const configPath = configResult.fold(
    (err) => {
      console.error(formatError(err))
      process.exit(2)
      return "" // unreachable
    },
    (p) => p,
  )

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

  const recipient = config.agent.recipient
  const configDir = dirname(configPath)

  // Resolve agent key if identity is configured
  let agentKey: string | undefined
  if (config.agent.identity) {
    const identityPath = resolve(configDir, expandPath(config.agent.identity))
    const keyResult = unwrapAgentKey(identityPath)
    agentKey = keyResult.fold(
      (err) => {
        const msg = err._tag === "IdentityNotFound" ? `not found: ${err.path}` : err.message
        console.error(`${YELLOW}Warning:${RESET} Could not unwrap agent key: ${msg}`)
        return undefined
      },
      (k) => k,
    )
  }

  // Resolve values via cascade
  const metaKeys = Object.keys(config.meta)
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
  const sealResult = sealSecrets(config.meta, values, recipient)

  sealResult.fold(
    (err) => {
      console.error(`${RED}Error:${RESET} Seal failed: ${err.message}`)
      process.exit(2)
    },
    (sealedMeta) => {
      writeSealedToml(configPath, sealedMeta)
      console.log(`${GREEN}Sealed${RESET} ${resolved} secret(s) into ${DIM}${configPath}${RESET}`)
    },
  )
}
