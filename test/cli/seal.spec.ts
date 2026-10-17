import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { collectEditedValues, parseStdinValue, resolveEditInput } from "../../src/cli/commands/seal.js"
import { bootSafe } from "../../src/core/boot.js"
import { loadConfig } from "../../src/core/config.js"
import { unsealSecrets } from "../../src/core/seal.js"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

let tmpDir: string
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-seal-cli-"))
  configPath = join(tmpDir, "envpkt.toml")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

type RunResult = { stdout: string; status: number }

const run = (args: string[], env?: Record<string, string>, input?: string): RunResult => {
  // spawnSync captures stdout AND stderr regardless of exit status (unlike
  // execFileSync which only returns stderr in the exception path). This makes
  // assertions over informational stderr output reliable on success.
  const result = spawnSync(TSX, [CLI_SRC, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
    env: { ...process.env, ...env },
    input,
  })
  return {
    stdout: (result.stdout ?? "") + (result.stderr ?? ""),
    status: result.status ?? 1,
  }
}

describe.skipIf(!ageInstalled)("envpkt seal — alias handling", () => {
  let recipient: string

  beforeEach(() => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    recipient = recipientLine!.replace("# public key: ", "").trim()
  })

  it("skips alias entries instead of trying to seal them", () => {
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.REAL_KEY]
service = "real"

[secret.ALIAS_KEY]
from_key = "secret.REAL_KEY"
`,
    )

    const { status, stdout } = run(["seal", "-c", configPath], { REAL_KEY: "real-value" })
    expect(status).toBe(0)
    // The alias must NOT have been sealed.
    const content = readFileSync(configPath, "utf-8")
    const aliasSection = content.slice(content.indexOf("[secret.ALIAS_KEY]"))
    expect(aliasSection).not.toContain("encrypted_value")
    // The real key MUST be sealed.
    expect(content).toContain("[secret.REAL_KEY]")
    const realSection = content.slice(content.indexOf("[secret.REAL_KEY]"), content.indexOf("[secret.ALIAS_KEY]"))
    expect(realSection).toContain("encrypted_value")
    // And the result still loads.
    expect(loadConfig(configPath).isRight()).toBe(true)
    // Friendly notice in stderr.
    expect(stdout).toContain("Skipping")
    expect(stdout).toContain("alias")
  })

  it("--edit refuses to seal an alias with a clear message", () => {
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.REAL_KEY]
service = "real"

[secret.ALIAS_KEY]
from_key = "secret.REAL_KEY"
`,
    )

    const { status, stdout } = run(["seal", "--edit", "ALIAS_KEY", "-c", configPath])
    expect(status).toBe(2)
    expect(stdout).toContain("alias")
    expect(stdout).toContain("from_key")
  })

  it("skips external entries instead of trying to seal them", () => {
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.REAL_KEY]
service = "real"

[secret.CF_MANAGED]
service = "supabase"
external = true
`,
    )

    const { status, stdout } = run(["seal", "-c", configPath], { REAL_KEY: "real-value" })
    expect(status).toBe(0)
    // The external entry must NOT have been sealed.
    const content = readFileSync(configPath, "utf-8")
    const extSection = content.slice(content.indexOf("[secret.CF_MANAGED]"))
    expect(extSection).not.toContain("encrypted_value")
    // The real key MUST still be sealed.
    const realSection = content.slice(content.indexOf("[secret.REAL_KEY]"), content.indexOf("[secret.CF_MANAGED]"))
    expect(realSection).toContain("encrypted_value")
    expect(loadConfig(configPath).isRight()).toBe(true)
    expect(stdout).toContain("Skipping")
    expect(stdout).toContain("external")
  })

  it("--edit refuses to seal an external entry with a clear message", () => {
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.CF_MANAGED]
service = "supabase"
external = true
`,
    )

    const { status, stdout } = run(["seal", "--edit", "CF_MANAGED", "-c", configPath])
    expect(status).toBe(2)
    expect(stdout).toContain("external")
  })
})

describe("collectEditedValues (--edit confirm-on-overwrite)", () => {
  // Fake prompt that answers based on the question text, recording every prompt shown.
  const scriptedPrompt = (answers: { confirm?: string; value?: string }, asked: string[]) => {
    return (question: string): Promise<string> => {
      asked.push(question)
      if (question.startsWith("Replace the sealed value")) return Promise.resolve(answers.confirm ?? "")
      return Promise.resolve(answers.value ?? "")
    }
  }

  const sealed = { S: { service: "x", encrypted_value: "ct" } }
  const unsealed = { U: { service: "x" } }

  it("does not prompt for confirmation on an unsealed entry", async () => {
    const asked: string[] = []
    const values = await collectEditedValues(["U"], unsealed, scriptedPrompt({ value: "newval" }, asked))
    expect(values).toEqual({ U: "newval" })
    expect(asked.some((q) => q.startsWith("Replace the sealed value"))).toBe(false)
  })

  it("confirms before overwriting an already-sealed entry, and skips on a non-affirmative answer", async () => {
    const asked: string[] = []
    const skips: string[] = []
    const values = await collectEditedValues(
      ["S"],
      sealed,
      scriptedPrompt({ confirm: "n", value: "newval" }, asked),
      (k) => skips.push(k),
    )
    expect(asked[0]).toContain("Replace the sealed value for S?")
    expect(values).toEqual({}) // declined → not changed, value never prompted/applied
    expect(skips).toEqual(["S"])
    // value prompt must not have been reached after declining
    expect(asked.some((q) => q.startsWith("Enter new value"))).toBe(false)
  })

  it("overwrites a sealed entry when the confirmation is affirmative", async () => {
    const asked: string[] = []
    const values = await collectEditedValues(["S"], sealed, scriptedPrompt({ confirm: "y", value: "fresh" }, asked))
    expect(values).toEqual({ S: "fresh" })
    expect(asked.some((q) => q.startsWith("Enter new value for S"))).toBe(true)
  })

  it("skips an empty value even after an affirmative confirm", async () => {
    const skips: string[] = []
    const values = await collectEditedValues(["S"], sealed, scriptedPrompt({ confirm: "yes", value: "" }, []), (k, r) =>
      skips.push(`${k}:${r}`),
    )
    expect(values).toEqual({})
    expect(skips).toEqual(["S:empty"])
  })

  it("skips a whitespace-only value as empty", async () => {
    const skips: string[] = []
    const values = await collectEditedValues(["U"], unsealed, scriptedPrompt({ value: "   " }, []), (k, r) =>
      skips.push(`${k}:${r}`),
    )
    expect(values).toEqual({})
    expect(skips).toEqual(["U:empty"])
  })
})

describe("resolveEditInput (--edit input source)", () => {
  it("prompts when a terminal is attached and --stdin is not passed", () => {
    expect(resolveEditInput(1, { stdin: false, isTTY: true }).orThrow()).toBe("prompt")
    expect(resolveEditInput(3, { stdin: false, isTTY: true }).orThrow()).toBe("prompt")
  })

  it("reads stdin for one key when no terminal is attached", () => {
    expect(resolveEditInput(1, { stdin: false, isTTY: false }).orThrow()).toBe("stdin")
  })

  it("reads stdin for one key when --stdin is passed, even in a terminal", () => {
    expect(resolveEditInput(1, { stdin: true, isTTY: true }).orThrow()).toBe("stdin")
  })

  it("refuses several keys on stdin", () => {
    const noTty = resolveEditInput(2, { stdin: false, isTTY: false })
    expect(noTty.isLeft()).toBe(true)
    expect(
      noTty.fold(
        (m) => m,
        () => "",
      ),
    ).toContain("exactly one key (got 2)")
    expect(resolveEditInput(2, { stdin: true, isTTY: true }).isLeft()).toBe(true)
  })
})

describe("parseStdinValue", () => {
  it("strips exactly one trailing newline", () => {
    expect(parseStdinValue("secret\n").orThrow()).toBe("secret")
    expect(parseStdinValue("secret\r\n").orThrow()).toBe("secret")
    expect(parseStdinValue("secret\n\n").orThrow()).toBe("secret\n")
    expect(parseStdinValue("secret").orThrow()).toBe("secret")
  })

  it("is empty for empty input, a lone newline, or whitespace only", () => {
    expect(parseStdinValue("").isEmpty).toBe(true)
    expect(parseStdinValue("\n").isEmpty).toBe(true)
    expect(parseStdinValue("   \n").isEmpty).toBe(true)
    expect(parseStdinValue(" \t\r\n").isEmpty).toBe(true)
  })
})

describe.skipIf(!ageInstalled)("envpkt seal --edit from stdin", () => {
  let recipient: string
  let identityPath: string

  beforeEach(() => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    recipient = recipientLine!.replace("# public key: ", "").trim()
    identityPath = join(tmpDir, "age-key.txt")
    writeFileSync(identityPath, keygenOutput)
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"

[secret.API_KEY]
service = "api"

[secret.OTHER_KEY]
service = "other"
`,
    )
  })

  const unsealed = (): Record<string, string> => {
    const config = loadConfig(configPath).orThrow()
    return unsealSecrets(config.secret ?? {}, identityPath).orThrow()
  }

  it("seals one key from piped stdin, stripping the trailing newline, and never prints it", () => {
    const { status, stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY"], {}, "piped-value-123\n")
    expect(status).toBe(0)
    expect(stdout).not.toContain("piped-value-123")
    expect(unsealed()).toEqual({ API_KEY: "piped-value-123" })
  })

  it("replaces an already-sealed value without a confirm prompt (rotation)", () => {
    expect(run(["seal", "-c", configPath, "--edit", "API_KEY"], {}, "first\n").status).toBe(0)
    const { status, stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY", "--stdin"], {}, "second\n")
    expect(status).toBe(0)
    expect(stdout).not.toContain("Replace the sealed value")
    expect(unsealed()).toEqual({ API_KEY: "second" })
  })

  it("fails clearly on empty stdin and leaves the file unchanged", () => {
    const before = readFileSync(configPath, "utf-8")
    const { status, stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY"], {}, "")
    expect(status).toBe(2)
    expect(stdout).toContain("No value on stdin for API_KEY")
    expect(readFileSync(configPath, "utf-8")).toBe(before)
  })

  it("fails on whitespace-only stdin", () => {
    const before = readFileSync(configPath, "utf-8")
    const { status, stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY"], {}, "   \n")
    expect(status).toBe(2)
    expect(stdout).toContain("No value on stdin for API_KEY")
    expect(readFileSync(configPath, "utf-8")).toBe(before)
  })

  it("says it is reading stdin even without a terminal", () => {
    const { stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY"], {}, "v\n")
    expect(stdout).toContain("Reading the value for API_KEY from stdin")
    expect(stdout).not.toContain("Ctrl-D")
  })

  it("refuses several --edit keys without a terminal", () => {
    const { status, stdout } = run(["seal", "-c", configPath, "--edit", "API_KEY,OTHER_KEY"], {}, "canary-k7q2x\n")
    expect(status).toBe(2)
    expect(stdout).toContain("exactly one key (got 2)")
    expect(stdout).not.toContain("canary-k7q2x")
  })

  it("refuses --stdin without --edit", () => {
    const { status, stdout } = run(["seal", "-c", configPath, "--stdin"], {}, "value\n")
    expect(status).toBe(2)
    expect(stdout).toContain("--stdin needs --edit")
  })
})

// Each test spawns several CLI processes and age calls; allow for a slow CI runner.
describe.skipIf(!ageInstalled)("envpkt seal — values survive sealing byte for byte", { timeout: 60_000 }, () => {
  // A PEM key keeps its final newline; stdin strips the one extra newline after it.
  const PEM =
    "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n"

  beforeEach(() => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()
    const identityPath = join(tmpDir, "age-key.txt")
    writeFileSync(identityPath, keygenOutput)
    writeFileSync(
      configPath,
      `version = 1

[identity]
name = "test"
recipient = "${recipient}"
key_file = "${identityPath}"

[secret.ENVPKT_WS_PEM]
service = "tls"

[secret.ENVPKT_WS_TOKEN]
service = "api"
`,
    )
  })

  const booted = (): Readonly<Record<string, string>> =>
    bootSafe({ configPath, inject: false }).fold(
      (err) => expect.unreachable(`boot failed: ${err._tag}`),
      (result) => result.secrets,
    )

  it("--reseal keeps a value's edge whitespace, and boot() returns it unchanged", () => {
    expect(run(["seal", "-c", configPath, "--edit", "ENVPKT_WS_PEM"], {}, `${PEM}\n`).status).toBe(0)
    expect(run(["seal", "-c", configPath, "--edit", "ENVPKT_WS_TOKEN"], {}, "  padded\t\n").status).toBe(0)
    expect(booted()).toEqual({ ENVPKT_WS_PEM: PEM, ENVPKT_WS_TOKEN: "  padded\t" })

    const before = readFileSync(configPath, "utf-8")
    expect(run(["seal", "-c", configPath, "--reseal"]).status).toBe(0)
    expect(readFileSync(configPath, "utf-8")).not.toBe(before)
    expect(booted()).toEqual({ ENVPKT_WS_PEM: PEM, ENVPKT_WS_TOKEN: "  padded\t" })
  })

  it("seals from env vars, stripping one trailing newline, and boot() returns the value", () => {
    const { status } = run(["seal", "-c", configPath], { ENVPKT_WS_PEM: `${PEM}\n`, ENVPKT_WS_TOKEN: "tok\n" })
    expect(status).toBe(0)
    expect(booted()).toEqual({ ENVPKT_WS_PEM: PEM, ENVPKT_WS_TOKEN: "tok" })
  })

  it("skips a whitespace-only env var instead of sealing it", () => {
    const { status, stdout } = run(["seal", "-c", configPath], { ENVPKT_WS_PEM: `${PEM}\n`, ENVPKT_WS_TOKEN: "   \n" })
    expect(status).toBe(0)
    expect(stdout).toContain("Skipped")
    expect(stdout).toContain("key(s) with no value: ENVPKT_WS_TOKEN")
    expect(booted()).toEqual({ ENVPKT_WS_PEM: PEM })
  })
})
