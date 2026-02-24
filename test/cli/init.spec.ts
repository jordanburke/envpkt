import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runInit } from "../../src/cli/commands/init.js"
import { loadConfig } from "../../src/core/config.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-init-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("envpkt init", () => {
  it("creates envpkt.toml with default template", () => {
    runInit(tmpDir, {})

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("version = 1")
    expect(content).toContain("#:schema")
    expect(content).toContain("[meta.EXAMPLE_API_KEY]")
    expect(content).toContain("[lifecycle]")
    expect(content).toContain("stale_warning_days = 90")
  })

  it("sets created date to today on generated secrets", () => {
    runInit(tmpDir, {})

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    const today = new Date().toISOString().split("T")[0]
    expect(content).toContain(`created = "${today}"`)
  })

  it("includes agent section when --agent is set", () => {
    runInit(tmpDir, { agent: true, name: "my-bot", capabilities: "read,write", expires: "2026-06-01" })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("[agent]")
    expect(content).toContain('name = "my-bot"')
    expect(content).toContain('"read"')
    expect(content).toContain('"write"')
    expect(content).toContain('expires = "2026-06-01"')
  })

  it("includes consumer comment in agent section", () => {
    runInit(tmpDir, { agent: true, name: "test" })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("consumer")
  })

  it("scaffolds from fnox.toml when --from-fnox is used", () => {
    const fnoxToml = `[OPENAI_KEY]\nvalue = "sk-xxx"\n\n[DB_PASSWORD]\nvalue = "secret"\n`
    writeFileSync(join(tmpDir, "fnox.toml"), fnoxToml)

    runInit(tmpDir, { fromFnox: join(tmpDir, "fnox.toml") })

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("[meta.OPENAI_KEY]")
    expect(content).toContain("[meta.DB_PASSWORD]")
    expect(content).not.toContain("[meta.EXAMPLE_API_KEY]")
  })

  it("includes v5 comment fields in generated secrets", () => {
    runInit(tmpDir, {})

    const content = readFileSync(join(tmpDir, "envpkt.toml"), "utf-8")
    expect(content).toContain("rotation_url")
    expect(content).toContain("source")
  })

  it("produces a parseable envpkt.toml", () => {
    runInit(tmpDir, {})

    const result = loadConfig(join(tmpDir, "envpkt.toml"))
    result.fold(
      (err) => expect.unreachable(`Generated config should be valid, got: ${err._tag}`),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.meta["EXAMPLE_API_KEY"]).toBeDefined()
      },
    )
  })
})
