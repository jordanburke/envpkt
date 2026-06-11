import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { collectEditedValues } from "../../src/cli/commands/seal.js"
import { loadConfig } from "../../src/core/config.js"

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

const run = (args: string[], env?: Record<string, string>): RunResult => {
  // spawnSync captures stdout AND stderr regardless of exit status (unlike
  // execFileSync which only returns stderr in the exception path). This makes
  // assertions over informational stderr output reliable on success.
  const result = spawnSync(TSX, [CLI_SRC, ...args], {
    cwd: tmpDir,
    encoding: "utf-8",
    env: { ...process.env, ...env },
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
})
