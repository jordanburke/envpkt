import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { Option, Try } from "functype"

const FNOX_CONFIG = "fnox.toml"

/** Detect fnox.toml in the given directory */
export const detectFnox = (dir: string): Option<string> => {
  const candidate = join(dir, FNOX_CONFIG)
  return existsSync(candidate) ? Option(candidate) : Option<string>(undefined)
}

/** Check if fnox CLI is available on PATH */
export const fnoxAvailable = (): boolean =>
  Try(() => {
    execFileSync("fnox", ["--version"], { stdio: "pipe" })
    return true
  }).fold(
    () => false,
    (v) => v,
  )
