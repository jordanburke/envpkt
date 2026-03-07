import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadConfig } from "../../src/core/config.js"
import { appendSection, removeSection, renameSection, updateSectionFields } from "../../src/core/toml-edit.js"

let tmpDir: string
let configPath: string

const baseToml = `version = 1

[secret.SOME_KEY]
service = "test"

[env.NODE_ENV]
value = "production"
purpose = "Runtime environment"
`

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-env-crud-test-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, baseToml)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("env add (via appendSection)", () => {
  it("appends a new env entry", () => {
    const raw = readFileSync(configPath, "utf-8")
    const block = `[env.LOG_LEVEL]\nvalue = "info"\npurpose = "Logging verbosity"\n`
    const updated = appendSection(raw, block)
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[env.LOG_LEVEL]")
    expect(content).toContain('value = "info"')
  })

  it("produces a parseable config after add", () => {
    const raw = readFileSync(configPath, "utf-8")
    const block = `[env.LOG_LEVEL]\nvalue = "debug"\npurpose = "Logging"\n`
    const updated = appendSection(raw, block)
    writeFileSync(configPath, updated, "utf-8")

    const result = loadConfig(configPath)
    result.fold(
      (err) => expect.unreachable(`Config should be valid after add, got: ${err._tag}`),
      (config) => {
        expect(config.env!["LOG_LEVEL"]).toBeDefined()
        expect(config.env!["LOG_LEVEL"]!.value).toBe("debug")
        expect(config.env!["NODE_ENV"]).toBeDefined()
      },
    )
  })
})

describe("env edit (via updateSectionFields)", () => {
  it("updates value and preserves other fields", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = updateSectionFields(raw, "[env.NODE_ENV]", { value: '"staging"' })
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('value = "staging"')
    expect(content).toContain('purpose = "Runtime environment"')
  })

  it("errors on nonexistent env entry", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = updateSectionFields(raw, "[env.NOPE]", { value: '"x"' })
    expect(result.isLeft()).toBe(true)
  })
})

describe("env rm (via removeSection)", () => {
  it("removes env section and preserves secrets", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = removeSection(raw, "[env.NODE_ENV]")
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[env.NODE_ENV]")
    expect(content).toContain("[secret.SOME_KEY]")
  })
})

describe("env rename (via renameSection)", () => {
  it("renames env entry preserving fields", () => {
    const raw = readFileSync(configPath, "utf-8")
    const result = renameSection(raw, "[env.NODE_ENV]", "[env.APP_ENV]")
    expect(result.isRight()).toBe(true)
    const updated = result.fold(
      () => "",
      (v) => v,
    )
    writeFileSync(configPath, updated, "utf-8")

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[env.NODE_ENV]")
    expect(content).toContain("[env.APP_ENV]")
    expect(content).toContain('value = "production"')
    expect(content).toContain('purpose = "Runtime environment"')
  })

  it("errors if target already exists", () => {
    const raw = readFileSync(configPath, "utf-8")
    const withTwo = appendSection(raw, `[env.APP_ENV]\nvalue = "dev"\n`)

    const result = renameSection(withTwo, "[env.NODE_ENV]", "[env.APP_ENV]")
    expect(result.isLeft()).toBe(true)
  })
})
