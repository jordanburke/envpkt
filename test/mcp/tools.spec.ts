import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { callTool, toolDefinitions } from "../../src/mcp/tools.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-mcp-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const writeConfig = (dir: string, content: string): string => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "envpkt.toml")
  writeFileSync(path, content)
  return path
}

const validConfig = `
version = 1

[agent]
name = "test-agent"
role = "processor"
capabilities = ["read", "write"]

[meta.API_KEY]
service = "stripe"
purpose = "Payment processing"
created = "2026-01-01"
expires = "2027-12-31"
capabilities = ["charge", "refund"]
provisioner = "vault"
rotation_url = "https://dashboard.stripe.com/apikeys"

[meta.DB_PASS]
service = "postgres"
purpose = "Main database access"
created = "2026-01-01"
capabilities = ["read", "write"]
provisioner = "manual"
`

const expiredConfig = `
version = 1

[meta.OLD_KEY]
service = "legacy"
created = "2020-01-01"
expires = "2022-01-01"
`

describe("toolDefinitions", () => {
  it("exposes four tools", () => {
    expect(toolDefinitions).toHaveLength(4)
    const names = toolDefinitions.map((t) => t.name)
    expect(names).toContain("getPacketHealth")
    expect(names).toContain("listCapabilities")
    expect(names).toContain("getSecretMeta")
    expect(names).toContain("checkExpiration")
  })

  it("all tools have valid inputSchema with type object", () => {
    for (const tool of toolDefinitions) {
      expect(tool.inputSchema.type).toBe("object")
    }
  })
})

describe("callTool", () => {
  it("returns error for unknown tool", () => {
    const result = callTool("nonexistent", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Unknown tool") })
  })

  describe("getPacketHealth", () => {
    it("returns health status for valid config", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("getPacketHealth", { configPath })
      expect(result.isError).toBeUndefined()

      const data = JSON.parse((result.content[0] as { text: string }).text)
      expect(data.status).toBe("healthy")
      expect(data.total).toBe(2)
      expect(data.healthy).toBe(2)
    })

    it("reports critical status for expired secrets", () => {
      const configPath = writeConfig(tmpDir, expiredConfig)
      const result = callTool("getPacketHealth", { configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)
      expect(data.status).toBe("critical")
      expect(data.expired).toBe(1)
    })

    it("returns error for missing config", () => {
      const result = callTool("getPacketHealth", { configPath: "/nonexistent/envpkt.toml" })
      expect(result.isError).toBe(true)
    })
  })

  describe("listCapabilities", () => {
    it("returns agent and secret capabilities", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("listCapabilities", { configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)

      expect(data.agent.name).toBe("test-agent")
      expect(data.agent.capabilities).toEqual(["read", "write"])
      expect(data.secrets.API_KEY).toEqual(["charge", "refund"])
      expect(data.secrets.DB_PASS).toEqual(["read", "write"])
    })

    it("returns null agent when no agent section", () => {
      const configPath = writeConfig(tmpDir, `version = 1\n[meta.X]\nservice = "x"\n`)
      const result = callTool("listCapabilities", { configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)
      expect(data.agent).toBeNull()
    })
  })

  describe("getSecretMeta", () => {
    it("returns metadata for existing key", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("getSecretMeta", { key: "API_KEY", configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)

      expect(data.key).toBe("API_KEY")
      expect(data.service).toBe("stripe")
      expect(data.purpose).toBe("Payment processing")
      expect(data.provisioner).toBe("vault")
    })

    it("returns error for missing key", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("getSecretMeta", { key: "NONEXISTENT", configPath })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain("Secret not found")
    })

    it("returns error when key argument is missing", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("getSecretMeta", { configPath })
      expect(result.isError).toBe(true)
    })
  })

  describe("checkExpiration", () => {
    it("returns expiration info for healthy secret", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("checkExpiration", { key: "API_KEY", configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)

      expect(data.key).toBe("API_KEY")
      expect(data.status).toBe("healthy")
      expect(data.days_remaining).toBeGreaterThan(0)
      expect(data.needs_rotation).toBe(false)
      expect(data.rotation_url).toBe("https://dashboard.stripe.com/apikeys")
    })

    it("reports expired secret needs rotation", () => {
      const configPath = writeConfig(tmpDir, expiredConfig)
      const result = callTool("checkExpiration", { key: "OLD_KEY", configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)

      expect(data.status).toBe("expired")
      expect(data.days_remaining).toBeLessThan(0)
      expect(data.needs_rotation).toBe(true)
    })

    it("returns null days_remaining when no expiration set", () => {
      const configPath = writeConfig(tmpDir, `version = 1\n[meta.NO_EXP]\nservice = "x"\n`)
      const result = callTool("checkExpiration", { key: "NO_EXP", configPath })
      const data = JSON.parse((result.content[0] as { text: string }).text)

      expect(data.days_remaining).toBeNull()
      expect(data.expires).toBeNull()
    })

    it("returns error for missing key", () => {
      const configPath = writeConfig(tmpDir, validConfig)
      const result = callTool("checkExpiration", { key: "NOPE", configPath })
      expect(result.isError).toBe(true)
    })
  })
})
