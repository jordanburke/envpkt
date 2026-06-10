import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

const shellAvailable = (sh: string): boolean => {
  try {
    execFileSync(sh, ["-c", "true"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}
const zshAvail = shellAvailable("zsh")
const bashAvail = shellAvailable("bash")

const emitHook = (shell: string): string => execFileSync(TSX, [CLI_SRC, "shell-hook", shell], { encoding: "utf-8" })

describe("shell-hook output", () => {
  it("zsh hook wires chpwd + dedup + --track inject + restore + audit, and runs once", () => {
    const out = emitHook("zsh")
    expect(out).toContain("add-zsh-hook chpwd _envpkt_chpwd")
    expect(out).toContain("envpkt config-path")
    expect(out).toContain("envpkt env export --track")
    expect(out).toContain("_envpkt_restore")
    expect(out).toContain("envpkt audit --format minimal")
    // run-once on install (chpwd doesn't fire at shell start)
    expect(out.trimEnd().endsWith("_envpkt_chpwd")).toBe(true)
  })

  it("bash hook wires PROMPT_COMMAND with a PWD guard + dedup", () => {
    const out = emitHook("bash")
    expect(out).toContain("PROMPT_COMMAND")
    expect(out).toContain('[ "$PWD" = "$_ENVPKT_PWD" ] && return')
    expect(out).toContain("envpkt config-path")
    expect(out).toContain("envpkt env export --track")
    expect(out).toContain("_envpkt_restore")
  })

  it("rejects an unsupported shell with exit 1", () => {
    let status = 0
    try {
      execFileSync(TSX, [CLI_SRC, "shell-hook", "fish"], { stdio: "pipe" })
    } catch (err) {
      status = (err as { status?: number }).status ?? 0
    }
    expect(status).toBe(1)
  })
})

describe("shell-hook integration", () => {
  let pkg: string
  let empty: string
  let home: string

  beforeEach(() => {
    pkg = mkdtempSync(join(tmpdir(), "envpkt-hook-pkg-"))
    empty = mkdtempSync(join(tmpdir(), "envpkt-hook-empty-"))
    home = mkdtempSync(join(tmpdir(), "envpkt-hook-home-"))
    writeFileSync(join(pkg, "envpkt.toml"), 'version = 1\n\n[env.GREETING]\nvalue = "hi"\n')
    mkdirSync(join(pkg, "src", "lib"), { recursive: true })
  })

  afterEach(() => {
    ;[pkg, empty, home].forEach((d) => rmSync(d, { recursive: true, force: true }))
  })

  // Isolate HOME (so the real global package isn't discovered) and clear config env vars.
  const runShell = (shell: string, script: string): string => {
    const env = { ...process.env, HOME: home, ENVPKT_SEARCH_PATH: "" }
    delete (env as Record<string, string | undefined>)["ENVPKT_CONFIG"]
    const shim = `envpkt() { "${TSX}" "${CLI_SRC}" "$@"; }\n`
    return execFileSync(shell, ["-c", shim + script], { encoding: "utf-8", timeout: 60000, env })
  }

  it.skipIf(!zshAvail)("zsh: loads on cd, dedups in a subdir, unsets on leave", () => {
    // chpwd fires in `zsh -c`, so cd alone drives the hook.
    const out = runShell(
      "zsh",
      [
        `cd "${empty}"`,
        `eval "$(envpkt shell-hook zsh)"`,
        `cd "${pkg}";         printf 'A=[%s]\\n' "\${GREETING-unset}"`,
        `cd "${pkg}/src/lib"; printf 'B=[%s]\\n' "\${GREETING-unset}"`,
        `cd "${empty}";       printf 'C=[%s]\\n' "\${GREETING-unset}"`,
      ].join("\n"),
    )
    expect(out).toContain("A=[hi]") // loaded from the package
    expect(out).toContain("B=[hi]") // subdir resolves the same package (upward-walk + dedup)
    expect(out).toContain("C=[unset]") // unset on leaving to a non-package dir
  })

  it.skipIf(!bashAvail)("bash: loads on cd and restores the prior value on leave", () => {
    // PROMPT_COMMAND doesn't fire in non-interactive `bash -c`, so drive _envpkt_prompt directly.
    const out = runShell(
      "bash",
      [
        `export GREETING=OUTER`,
        `cd "${empty}"`,
        `eval "$(envpkt shell-hook bash)"`,
        `cd "${pkg}";   _envpkt_prompt; printf 'A=[%s]\\n' "$GREETING"`,
        `cd "${empty}"; _envpkt_prompt; printf 'C=[%s]\\n' "$GREETING"`,
      ].join("\n"),
    )
    expect(out).toContain("A=[hi]") // package value loaded
    expect(out).toContain("C=[OUTER]") // prior value restored, not blind-unset
  })
})
