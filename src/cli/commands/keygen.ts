import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { Option, Try } from "functype"

import { parseToml, readConfigFile } from "../../core/config.js"
import { generateKeypair, resolveKeyPath, updateConfigIdentity } from "../../core/keygen.js"
import { BOLD, CYAN, DIM, formatError, GREEN, RESET, YELLOW } from "../output.js"

type KeygenOptions = {
  readonly config?: string
  readonly output?: string
  readonly global?: boolean
}

/** Shorten a path under $HOME to use ~ prefix. `p` is a real path, so $HOME is compared as given and as a real path. */
const tildeShorten = (p: string): string => {
  const home = homedir()
  const homes = [home, Try(() => realpathSync(home)).orElse(home)]
  const match = homes.find((h) => p === h || p.startsWith(h + sep))
  return match === undefined ? p : `~${p.slice(match.length)}`
}

/** Derive a default identity name from the config path's parent directory */
const deriveIdentityName = (configPath: string): string => basename(dirname(resolve(configPath)))

/** The raw TOML's identity.name, read without schema validation so an invalid config keeps its name */
const field =
  (key: string) =>
  (value: unknown): Option<unknown> =>
    typeof value === "object" && value !== null ? Option((value as Record<string, unknown>)[key]) : Option.none()

const nonEmptyString = (value: unknown): Option<string> =>
  typeof value === "string" && value !== "" ? Option(value) : Option.none()

const rawIdentityName = (data: unknown): Option<string> =>
  field("identity")(data).flatMap(field("name")).flatMap(nonEmptyString)

/** Keep the config's identity.name if it has one; otherwise derive one */
const identityName = (configPath: string): string =>
  readConfigFile(configPath)
    .flatMap(parseToml)
    .toOption()
    .flatMap(rawIdentityName)
    .orElse(deriveIdentityName(configPath))

/**
 * The key_file value to write. boot resolves key_file against the config's directory, so a key
 * inside that directory is written relative to it; any other key is written as an absolute path,
 * shortened to ~ under $HOME.
 */
const keyFileFor = (configPath: string, identityPath: string): string => {
  // Compare real paths: on macOS the cwd can be /private/var/… while a passed path says /var/….
  const realPath = (p: string): string => Try(() => realpathSync(p)).orElse(resolve(p))
  const abs = realPath(identityPath)
  const rel = relative(realPath(dirname(configPath)), abs)
  const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  return outside ? tildeShorten(abs) : rel
}

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

export const runKeygen = async (options: KeygenOptions): Promise<void> => {
  const configPath = resolve(options.config ?? join(process.cwd(), "envpkt.toml"))
  const outputPath = options.output ?? (options.global ? resolveKeyPath() : deriveKeyPath(configPath))

  const result = await generateKeypair({ outputPath })

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
        const name = identityName(configPath)
        const keyFile = keyFileFor(configPath, identityPath)
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
