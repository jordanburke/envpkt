import { execFileSync } from "node:child_process"

import { Try } from "functype"

import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "../output.js"

const getCurrentVersion = (): string =>
  Try(() =>
    execFileSync("npm", ["list", "-g", "envpkt", "--json"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }),
  ).fold(
    () => "unknown",
    (output) => output.match(/"envpkt":\s*\{\s*"version":\s*"([^"]+)"/)?.[1] ?? "unknown",
  )

export const runUpgrade = (): void => {
  const before = getCurrentVersion()
  console.log(`${DIM}Current version: ${before}${RESET}`)
  console.log(`${CYAN}Upgrading envpkt...${RESET}\n`)

  Try(() =>
    execFileSync("npm", ["install", "-g", "envpkt@latest", "--prefer-online"], {
      stdio: "inherit",
      encoding: "utf-8",
    }),
  ).fold(
    () => {
      console.error(`\n${RED}Error:${RESET} npm install failed. Trying with cache clean...`)
      Try(() => {
        execFileSync("npm", ["cache", "clean", "--force"], { stdio: "inherit" })
        execFileSync("npm", ["install", "-g", "envpkt@latest"], { stdio: "inherit", encoding: "utf-8" })
      }).fold(
        () => {
          console.error(`${RED}Error:${RESET} Upgrade failed. Try manually:`)
          console.error(`  ${BOLD}sudo npm install -g envpkt@latest --prefer-online${RESET}`)
          process.exit(1)
        },
        () => {},
      )
    },
    () => {},
  )

  const after = getCurrentVersion()
  if (before === after && before !== "unknown") {
    console.log(`\n${GREEN}✓${RESET} Already on latest version ${BOLD}${after}${RESET}`)
  } else {
    console.log(`\n${GREEN}✓${RESET} Upgraded ${YELLOW}${before}${RESET} → ${BOLD}${after}${RESET}`)
  }
}
