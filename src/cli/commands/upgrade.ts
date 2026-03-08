import { execFileSync } from "node:child_process"

import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "../output.js"

const getCurrentVersion = (): string => {
  try {
    const output = execFileSync("npm", ["list", "-g", "envpkt", "--json"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return output.match(/"envpkt":\s*\{\s*"version":\s*"([^"]+)"/)?.[1] ?? "unknown"
  } catch {
    return "unknown"
  }
}

export const runUpgrade = (): void => {
  const before = getCurrentVersion()
  console.log(`${DIM}Current version: ${before}${RESET}`)
  console.log(`${CYAN}Upgrading envpkt...${RESET}\n`)

  try {
    execFileSync("npm", ["install", "-g", "envpkt@latest", "--prefer-online"], {
      stdio: "inherit",
      encoding: "utf-8",
    })
  } catch {
    console.error(`\n${RED}Error:${RESET} npm install failed. Trying with cache clean...`)
    try {
      execFileSync("npm", ["cache", "clean", "--force"], { stdio: "inherit" })
      execFileSync("npm", ["install", "-g", "envpkt@latest"], { stdio: "inherit", encoding: "utf-8" })
    } catch {
      console.error(`${RED}Error:${RESET} Upgrade failed. Try manually:`)
      console.error(`  ${BOLD}sudo npm install -g envpkt@latest --prefer-online${RESET}`)
      process.exit(1)
    }
  }

  const after = getCurrentVersion()
  if (before === after && before !== "unknown") {
    console.log(`\n${GREEN}✓${RESET} Already on latest version ${BOLD}${after}${RESET}`)
  } else {
    console.log(`\n${GREEN}✓${RESET} Upgraded ${YELLOW}${before}${RESET} → ${BOLD}${after}${RESET}`)
  }
}
