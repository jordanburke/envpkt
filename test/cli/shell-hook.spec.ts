import { execFileSync, spawnSync } from "node:child_process"
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

const emitHook = (...args: string[]): string =>
  execFileSync(TSX, [CLI_SRC, "shell-hook", ...args], { encoding: "utf-8" })

describe("shell-hook output", () => {
  it("zsh hook wires chpwd + dedup + restore + audit, runs once, and does NOT mute the inject", () => {
    const out = emitHook("zsh")
    expect(out).toContain("add-zsh-hook chpwd _envpkt_chpwd")
    expect(out).toContain("envpkt config-path")
    expect(out).toContain("_envpkt_restore")
    expect(out).toContain("envpkt audit --format minimal")
    // The inject must NOT suppress stderr — hard errors (SealKeyUnavailable) surface on cd.
    expect(out).toContain('eval "$(envpkt env export --track)"')
    expect(out).not.toContain("env export --track 2>/dev/null")
    // run-once on install (chpwd doesn't fire at shell start)
    expect(out.trimEnd().endsWith("_envpkt_chpwd")).toBe(true)
  })

  it("bash hook handles both string and array PROMPT_COMMAND", () => {
    const out = emitHook("bash")
    expect(out).toContain('declare -a"*') // array-form detection
    expect(out).toContain("PROMPT_COMMAND+=(_envpkt_prompt)") // array append
    expect(out).toContain('PROMPT_COMMAND="_envpkt_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"') // string form
    expect(out).toContain('eval "$(envpkt env export --track)"')
  })

  it("--no-audit omits the audit line", () => {
    expect(emitHook("zsh")).toContain("envpkt audit --format minimal")
    expect(emitHook("zsh", "--no-audit")).not.toContain("envpkt audit")
    expect(emitHook("bash", "--no-audit")).not.toContain("envpkt audit")
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
    writeFileSync(join(pkg, "envpkt.toml"), 'version = 1\nscope = "shell"\n\n[env.GREETING]\nvalue = "hi"\n')
    mkdirSync(join(pkg, "src", "lib"), { recursive: true })
  })

  afterEach(() => {
    ;[pkg, empty, home].forEach((d) => rmSync(d, { recursive: true, force: true }))
  })

  // Isolate HOME (so the real global package isn't discovered) and clear config env vars.
  const runShell = (shell: string, script: string): { out: string; status: number } => {
    const env = { ...process.env, HOME: home, ENVPKT_SEARCH_PATH: "" }
    delete (env as Record<string, string | undefined>)["ENVPKT_CONFIG"]
    const shim = `envpkt() { "${TSX}" "${CLI_SRC}" "$@"; }\n`
    const r = spawnSync(shell, ["-c", shim + script], { encoding: "utf-8", timeout: 60000, env })
    return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status ?? 1 }
  }

  it.skipIf(!zshAvail)(
    "zsh: loads on cd, dedups in a subdir, unsets on leave",
    () => {
      const { out } = runShell(
        "zsh",
        [
          `cd "${empty}"`,
          `eval "$(envpkt shell-hook zsh)"`,
          `cd "${pkg}";         printf 'A=[%s]\\n' "\${GREETING-unset}"`,
          `cd "${pkg}/src/lib"; printf 'B=[%s]\\n' "\${GREETING-unset}"`,
          `cd "${empty}";       printf 'C=[%s]\\n' "\${GREETING-unset}"`,
        ].join("\n"),
      )
      expect(out).toContain("A=[hi]")
      expect(out).toContain("B=[hi]") // subdir resolves the same package (upward-walk + dedup)
      expect(out).toContain("C=[unset]")
    },
    60_000,
  )

  it.skipIf(!bashAvail)(
    "bash: loads on cd and restores the prior value on leave",
    () => {
      const { out } = runShell(
        "bash",
        [
          `export GREETING=OUTER`,
          `cd "${empty}"`,
          `eval "$(envpkt shell-hook bash)"`,
          `cd "${pkg}";   _envpkt_prompt; printf 'A=[%s]\\n' "$GREETING"`,
          `cd "${empty}"; _envpkt_prompt; printf 'C=[%s]\\n' "$GREETING"`,
        ].join("\n"),
      )
      expect(out).toContain("A=[hi]")
      expect(out).toContain("C=[OUTER]") // prior value restored, not blind-unset
    },
    60_000,
  )

  it.skipIf(!zshAvail)(
    "zsh: a missing seal key surfaces on cd (inject is not stderr-muted)",
    () => {
      // Sealed package, scope=shell, no resolvable key (HOME isolated) → SealKeyUnavailable.
      // The guard fires before decryption, so this needs no age.
      const sealedPkg = mkdtempSync(join(tmpdir(), "envpkt-hook-sealed-"))
      writeFileSync(
        join(sealedPkg, "envpkt.toml"),
        [
          "version = 1",
          'scope = "shell"',
          "[identity]",
          'name = "t"',
          'recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"',
          "[secret.API_KEY]",
          'service = "s"',
          'encrypted_value = """',
          "-----BEGIN AGE ENCRYPTED FILE-----",
          "ZmFrZQ==",
          "-----END AGE ENCRYPTED FILE-----",
          '"""',
        ].join("\n"),
      )
      try {
        const { out } = runShell(
          "zsh",
          [`cd "${empty}"`, `eval "$(envpkt shell-hook zsh)"`, `cd "${sealedPkg}"`].join("\n"),
        )
        expect(out).toMatch(/no age key|can't be decrypted/)
      } finally {
        rmSync(sealedPkg, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
