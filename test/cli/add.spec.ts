import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runAdd } from "../../src/cli/commands/add.js"
import { loadConfig } from "../../src/core/config.js"

let tmpDir: string
let configPath: string

const baseToml = `version = 1\n\n[secret.EXISTING_KEY]\nservice = "test"\n`

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-add-test-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, baseToml)
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("envpkt add", () => {
  it("appends a new secret with minimal options", () => {
    runAdd("NEW_SECRET", { config: configPath })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[secret.NEW_SECRET]")

    const today = new Date().toISOString().split("T")[0]
    expect(content).toContain(`created = "${today}"`)
  })

  it("preserves existing config content", () => {
    runAdd("NEW_SECRET", { config: configPath })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[secret.EXISTING_KEY]")
    expect(content).toContain('service = "test"')
  })

  it("includes all provided metadata fields", () => {
    runAdd("FULL_SECRET", {
      config: configPath,
      service: "stripe",
      purpose: "Payment processing",
      comment: "Production key",
      expires: "2027-01-01",
      rotates: "90d",
      rateLimit: "1000/min",
      modelHint: "gpt-4",
      source: "vault",
      rotationUrl: "https://dashboard.stripe.com/apikeys",
      required: true,
      capabilities: "read,write",
      tags: "env=prod,team=payments",
    })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('service = "stripe"')
    expect(content).toContain('purpose = "Payment processing"')
    expect(content).toContain('comment = "Production key"')
    expect(content).toContain('expires = "2027-01-01"')
    expect(content).toContain('rotates = "90d"')
    expect(content).toContain('rate_limit = "1000/min"')
    expect(content).toContain('model_hint = "gpt-4"')
    expect(content).toContain('source = "vault"')
    expect(content).toContain('rotation_url = "https://dashboard.stripe.com/apikeys"')
    expect(content).toContain("required = true")
    expect(content).toContain('capabilities = ["read", "write"]')
    expect(content).toContain("tags = {")
    expect(content).toContain('env = "prod"')
    expect(content).toContain('team = "payments"')
  })

  it("produces a parseable config after add", () => {
    runAdd("API_KEY", { config: configPath, service: "openai", purpose: "LLM calls" })

    const result = loadConfig(configPath)
    result.fold(
      (err) => expect.unreachable(`Config should be valid after add, got: ${err._tag}`),
      (config) => {
        expect(config.secret!["API_KEY"]).toBeDefined()
        expect(config.secret!["API_KEY"]!.service).toBe("openai")
        expect(config.secret!["API_KEY"]!.purpose).toBe("LLM calls")
        expect(config.secret!["EXISTING_KEY"]).toBeDefined()
      },
    )
  })

  it("rejects duplicate secret name", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit")
    })

    expect(() => runAdd("EXISTING_KEY", { config: configPath })).toThrow("process.exit")
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
  })

  it("rejects invalid date format", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit")
    })

    expect(() => runAdd("NEW_KEY", { config: configPath, expires: "not-a-date" })).toThrow("process.exit")
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
  })

  it("dry-run does not modify the file", () => {
    runAdd("DRY_RUN_KEY", { config: configPath, service: "test", dryRun: true })

    const content = readFileSync(configPath, "utf-8")
    expect(content).not.toContain("[secret.DRY_RUN_KEY]")
    expect(content).toBe(baseToml)
  })
})
