import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runAddEnv } from "../../src/cli/commands/add-env.js"
import { loadConfig } from "../../src/core/config.js"

let tmpDir: string
let configPath: string

const baseToml = `version = 1\n\n[secret.SOME_KEY]\nservice = "test"\n`

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-add-env-test-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, baseToml)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("envpkt add-env", () => {
  it("appends a new env entry with name and value", () => {
    runAddEnv("NODE_ENV", "production", { config: configPath })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[env.NODE_ENV]")
    expect(content).toContain('value = "production"')
  })

  it("preserves existing config content", () => {
    runAddEnv("NODE_ENV", "production", { config: configPath })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[secret.SOME_KEY]")
  })

  it("includes optional metadata fields", () => {
    runAddEnv("LOG_LEVEL", "info", {
      config: configPath,
      purpose: "Controls logging verbosity",
      comment: "Set to debug for troubleshooting",
      tags: "env=prod,scope=logging",
    })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('purpose = "Controls logging verbosity"')
    expect(content).toContain('comment = "Set to debug for troubleshooting"')
    expect(content).toContain('env = "prod"')
    expect(content).toContain('scope = "logging"')
  })

  it("produces a parseable config after add-env", () => {
    runAddEnv("NODE_ENV", "production", { config: configPath, purpose: "Runtime env" })

    const result = loadConfig(configPath)
    result.fold(
      (err) => expect.unreachable(`Config should be valid after add-env, got: ${err._tag}`),
      (config) => {
        expect(config.env!["NODE_ENV"]).toBeDefined()
        expect(config.env!["NODE_ENV"]!.value).toBe("production")
        expect(config.env!["NODE_ENV"]!.purpose).toBe("Runtime env")
      },
    )
  })

  it("rejects duplicate env entry", () => {
    const tomlWithEnv = `${baseToml}\n[env.NODE_ENV]\nvalue = "production"\n`
    writeFileSync(configPath, tomlWithEnv)

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit")
    })

    expect(() => runAddEnv("NODE_ENV", "staging", { config: configPath })).toThrow("process.exit")
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
  })

  it("dry-run does not modify the file", () => {
    runAddEnv("NODE_ENV", "production", { config: configPath, dryRun: true })

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[env.NODE_ENV]")
    expect(content).toBe(baseToml)
  })
})
