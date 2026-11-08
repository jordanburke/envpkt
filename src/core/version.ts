import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const findPkgJson = (dir: string): string => {
  if (existsSync(join(dir, "package.json"))) return join(dir, "package.json")
  const parent = dirname(dir)
  return parent === dir ? "" : findPkgJson(parent)
}

/**
 * envpkt's own version, read from the nearest package.json above this module: the repo's in
 * development, `node_modules/envpkt/package.json` once installed. "0.0.0" when there is none.
 */
export const packageVersion = (): string => {
  const pkgPath = findPkgJson(dirname(fileURLToPath(import.meta.url)))
  return pkgPath ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version : "0.0.0"
}
