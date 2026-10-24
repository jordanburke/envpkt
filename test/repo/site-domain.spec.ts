import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..", "..")

// The docs site is served from envpkt.com. The .dev name was never registered: a placeholder that
// reached the site config and the README, so every page declared a dead canonical URL.
const SITE = "https://envpkt.com"
const UNOWNED_DOMAIN = ["envpkt", "dev"].join(".")

const trackedFiles = (): ReadonlyArray<string> =>
  execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8" }).split("\0").filter(Boolean)

describe("site domain", () => {
  it("builds the docs site for envpkt.com", () => {
    const config = readFileSync(join(root, "site", "astro.config.mjs"), "utf-8")
    expect(config).toContain(`site: "${SITE}"`)
  })

  it("never links to the unregistered .dev domain", () => {
    const offenders = trackedFiles().filter((file) => readFileSync(join(root, file), "utf-8").includes(UNOWNED_DOMAIN))
    expect(offenders).toEqual([])
  })
})
