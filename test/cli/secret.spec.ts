import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
