import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

import { generateKeypair, resolveKeyPath, updateConfigIdentity } from "../../core/keygen.js"
import { BOLD, CYAN, DIM, formatError, GREEN, RESET, YELLOW } from "../output.js"

type KeygenOptions = {
  readonly config?: string
  readonly output?: string
  readonly global?: boolean
}

/** Shorten a path under $HOME to use ~ prefix */
const tildeShorten = (p: string): string => {
  const home = homedir()
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

/** Derive a default identity name from the config path's parent directory */
const deriveIdentityName = (configPath: string): string => basename(dirname(resolve(configPath)))

/**
 * Derive a project-specific key path from the config path.
 * - `envpkt.toml` → `~/.envpkt/<dir>-key.txt`
 * - `prod.envpkt.toml` → `~/.envpkt/<dir>-prod-key.txt`
 * - `foo.envpkt.toml` → `~/.envpkt/<dir>-foo-key.txt`
 */
const deriveKeyPath = (configPath: string): string => {
  const abs = resolve(configPath)
  const dir = basename(dirname(abs))
  const stem = basename(abs)
    .replace(/\.envpkt\.toml$/, "")
    .replace(/\.toml$/, "")
  const name = stem === "envpkt" || stem === "" ? dir : `${dir}-${stem}`
  return join(homedir(), ".envpkt", `${name}-key.txt`)
}

export const runKeygen = (options: KeygenOptions): void => {
  const configPath = resolve(options.config ?? join(process.cwd(), "envpkt.toml"))
  const outputPath = options.output ?? (options.global ? resolveKeyPath() : deriveKeyPath(configPath))

  const result = generateKeypair({ outputPath })

  result.fold(
    (err) => {
      if (err._tag === "KeyExists") {
        console.error(`${YELLOW}Warning:${RESET} Identity file already exists: ${CYAN}${err.path}${RESET}`)
        console.error(`${DIM}To replace it: remove the file first, then re-run keygen.${RESET}`)
        console.error(`${DIM}To use a different path: pass -o <path>.${RESET}`)
        process.exit(1)
      }
      console.error(formatError(err))
      process.exit(2)
    },
    ({ recipient, identityPath }) => {
      console.log(`${GREEN}Generated${RESET} age identity: ${CYAN}${identityPath}${RESET}`)
      console.log(`${BOLD}Recipient:${RESET} ${recipient}`)
      console.log("")

      // Try to update envpkt.toml if it exists
      if (existsSync(configPath)) {
        const name = deriveIdentityName(configPath)
        const keyFile = tildeShorten(identityPath)
        const updateResult = updateConfigIdentity(configPath, { recipient, name, keyFile })
        updateResult.fold(
          (err) => {
            console.error(
              `${YELLOW}Warning:${RESET} Could not update config: ${"message" in err ? err.message : err._tag}`,
            )
            console.log(`${DIM}Manually add to your envpkt.toml:${RESET}`)
            console.log(`  [identity]`)
            console.log(`  name = "${name}"`)
            console.log(`  recipient = "${recipient}"`)
            console.log(`  key_file = "${keyFile}"`)
          },
          () => {
            console.log(
              `${GREEN}Updated${RESET} ${CYAN}${configPath}${RESET} with identity (name, recipient, key_file)`,
            )
          },
        )
      } else {
        console.log(`${BOLD}Next steps:${RESET}`)
        console.log(`  ${DIM}1.${RESET} envpkt init          ${DIM}# create envpkt.toml${RESET}`)
        console.log(`  ${DIM}2.${RESET} envpkt env scan --write  ${DIM}# discover credentials${RESET}`)
        console.log(`  ${DIM}3.${RESET} envpkt seal           ${DIM}# encrypt secret values${RESET}`)
      }
    },
  )
}
