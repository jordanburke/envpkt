import { resolveConfigPath } from "../../core/config.js"

type ConfigPathOptions = {
  readonly config?: string
}

/**
 * Print the `envpkt.toml` path resolved for the current directory, or nothing if none
 * is found. Resolve-only: no config load, no boot, no decryption — cheap enough for a
 * per-`cd` shell hook to gate on. Always exits 0; a missing config means "no package
 * here", not an error.
 */
export const runConfigPath = (options: ConfigPathOptions): void => {
  resolveConfigPath(options.config).fold(
    () => {
      // No config resolved — emit nothing, exit 0.
    },
    ({ path }) => {
      console.log(path)
    },
  )
}
