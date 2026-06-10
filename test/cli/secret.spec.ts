import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadConfig } from "../../src/core/config.js"

// We test by importing the CLI runner indirectly via execFileSync to match e2e patterns,
// but for unit tests we call the functions directly. Since registerSecretCommands wires
// Commander, we re-test the core logic by calling the underlying functions through the
// CLI entry point using tsx. For unit-level testing, we validate the TOML editing works
// by using the core functions directly.

import { appendSection, removeSection, renameSection, updateSectionFields } from "../../src/core/toml-edit.js"

let tmpDir: string
let configPath: string

const baseToml = `version = 1

[secret.EXISTING_KEY]
service = "test"
purpose = "Testing"
`

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-secret-test-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, baseToml)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("secret add (via appendSection)", () => {
  it("appends a new secret block", () => {
    const raw = readFileSync(configPath, "utf-8")
    const block = `[secret.NEW_SECRET]\nservice = "new"\n`
    const updated = appendSection(raw, block)
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[secret.NEW_SECRET]")
    expect(content).toContain("[secret.EXISTING_KEY]")
  })

  it("produces a parseable config after add", () => {
    const raw = readFileSync(configPath, "utf-8")
    const today = new Date().toISOString().split("T")[0]
    const block = `[secret.API_KEY]\nservice = "openai"\npurpose = "LLM calls"\ncreated = "${today}"\n`
    const updated = appendSection(raw, block)
    writeFileSync(configPath, updated, "utf-8")

    const result = loadConfig(configPath)
    result.fold(
      (err) => expect.unreachable(`Config should be valid after add, got: ${err._tag}`),
      (config) => {
        expect(config.secret!["API_KEY"]).toBeDefined()
        expect(config.secret!["API_KEY"]!.service).toBe("openai")
        expect(config.secret!["EXISTING_KEY"]).toBeDefined()
      },
    )
  })
})

describe("secret edit (via updateSectionFields)", () => {
  it("modifies one field and preserves others", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = updateSectionFields(raw, "[secret.EXISTING_KEY]", { service: '"updated"' })
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('service = "updated"')
    expect(content).toContain('purpose = "Testing"')
  })

  it("errors on nonexistent secret", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = updateSectionFields(raw, "[secret.NOPE]", { service: '"x"' })
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SectionNotFound"),
      () => expect.unreachable("Should be Left"),
    )
  })
})

describe("secret rm (via removeSection)", () => {
  it("removes the section and preserves others", () => {
    // Add a second secret first
    const raw = readFileSync(configPath, "utf-8")
    const withTwo = appendSection(raw, `[secret.SECOND]\nservice = "two"\n`)
    writeFileSync(configPath, withTwo, "utf-8")

    const result = removeSection(readFileSync(configPath, "utf-8"), "[secret.EXISTING_KEY]")
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[secret.EXISTING_KEY]")
    expect(content).toContain("[secret.SECOND]")
  })
})

describe("secret rename (via renameSection)", () => {
  it("renames and preserves all fields", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = renameSection(raw, "[secret.EXISTING_KEY]", "[secret.RENAMED_KEY]")
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[secret.EXISTING_KEY]")
    expect(content).toContain("[secret.RENAMED_KEY]")
    expect(content).toContain('service = "test"')
    expect(content).toContain('purpose = "Testing"')
  })

  it("errors if new name already exists", () => {
    const raw = readFileSync(configPath, "utf-8")
    const withTwo = appendSection(raw, `[secret.TARGET]\nservice = "target"\n`)

    const result = renameSection(withTwo, "[secret.EXISTING_KEY]", "[secret.TARGET]")
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SectionAlreadyExists"),
      () => expect.unreachable("Should be Left"),
    )
  })
})

// CLI-level tests for behavior that lives in the command layer (flag parsing,
// --unset, dry-run validation) rather than in the core toml-edit functions.
const __testDir = dirname(fileURLToPath(import.meta.url))
const CLI_SRC = resolve(__testDir, "../..", "src/cli/index.ts")
const TSX = resolve(__testDir, "../..", "node_modules/.bin/tsx")

const runCli = (args: string[]): { stdout: string; stderr: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      env: { ...process.env },
      encoding: "utf-8",
      timeout: 15000,
    })
    return { stdout, stderr: "", status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 }
  }
}

describe("secret edit --unset (CLI)", () => {
  const tomlWithOptionals = `version = 1

[secret.MY_KEY]
service = "stripe"
expires = "2026-12-31"
rate_limit = "1000/min"
`

  it("removes an optional field and preserves the rest", () => {
    writeFileSync(configPath, tomlWithOptionals)
    const { status } = runCli(["secret", "edit", "MY_KEY", "--unset", "expires", "-c", configPath])
    expect(status).toBe(0)

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("expires")
    expect(content).toContain('service = "stripe"')
    expect(content).toContain('rate_limit = "1000/min"')
  })

  it("removes multiple fields when --unset is repeated", () => {
    writeFileSync(configPath, tomlWithOptionals)
    const { status } = runCli([
      "secret",
      "edit",
      "MY_KEY",
      "--unset",
      "expires",
      "--unset",
      "rate_limit",
      "-c",
      configPath,
    ])
    expect(status).toBe(0)

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("expires")
    expect(content).not.toContain("rate_limit")
    expect(content).toContain('service = "stripe"')
  })

  it("rejects an unknown field instead of silently doing nothing", () => {
    writeFileSync(configPath, tomlWithOptionals)
    const { stderr, status } = runCli(["secret", "edit", "MY_KEY", "--unset", "bogus", "-c", configPath])
    expect(status).toBe(1)
    expect(stderr).toContain("unknown field")
    // File must be untouched
    expect(readFileSync(configPath, "utf-8")).toBe(tomlWithOptionals)
  })

  it("the result still loads as a valid config after unsetting", () => {
    writeFileSync(configPath, tomlWithOptionals)
    runCli(["secret", "edit", "MY_KEY", "--unset", "expires", "-c", configPath])
    loadConfig(configPath).fold(
      (err) => expect.unreachable(`Config should be valid after unset, got: ${err._tag}`),
      (config) => expect(config.secret!["MY_KEY"]!.expires).toBeUndefined(),
    )
  })
})

describe("secret edit --dry-run validation (CLI)", () => {
  const tomlWithExpires = `version = 1

[secret.MY_KEY]
service = "stripe"
expires = "2026-12-31"
`

  it("dry-run rejects an edit the real write would reject (no misleading preview)", () => {
    // The secondary bug in #31: --dry-run skipped the schema validation the real
    // write runs, so it happily previewed expires = "" which then failed on write.
    writeFileSync(configPath, tomlWithExpires)
    const { stderr, status } = runCli(["secret", "edit", "MY_KEY", "--expires", "", "--dry-run", "-c", configPath])
    expect(status).toBe(1)
    expect(stderr).toContain("invalid config")
    // dry-run never writes
    expect(readFileSync(configPath, "utf-8")).toBe(tomlWithExpires)
  })

  it("dry-run previews a valid edit without writing", () => {
    writeFileSync(configPath, tomlWithExpires)
    const { stdout, status } = runCli([
      "secret",
      "edit",
      "MY_KEY",
      "--expires",
      "2027-01-01",
      "--dry-run",
      "-c",
      configPath,
    ])
    expect(status).toBe(0)
    expect(stdout).toContain("2027-01-01")
    // file unchanged by dry-run
    expect(readFileSync(configPath, "utf-8")).toBe(tomlWithExpires)
  })
})
