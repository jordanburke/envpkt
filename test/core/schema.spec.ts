import { describe, expect, it } from "vitest"
import { TypeCompiler } from "@sinclair/typebox/compiler"
import { EnvpktConfigSchema, SecretMetaSchema, AgentIdentitySchema, EnvMetaSchema } from "../../src/core/schema.js"

const configChecker = TypeCompiler.Compile(EnvpktConfigSchema)
const secretMetaChecker = TypeCompiler.Compile(SecretMetaSchema)
const agentChecker = TypeCompiler.Compile(AgentIdentitySchema)
const envMetaChecker = TypeCompiler.Compile(EnvMetaSchema)

describe("EnvpktConfigSchema", () => {
  it("validates a minimal config", () => {
    const config = {
      version: 1,
      secret: {
        API_KEY: { service: "example" },
      },
    }
    expect(configChecker.Check(config)).toBe(true)
  })

  it("validates a config with empty secret entry (service is now optional)", () => {
    const config = {
      version: 1,
      secret: { API_KEY: {} },
    }
    expect(configChecker.Check(config)).toBe(true)
  })

  it("validates a full config", () => {
    const config = {
      version: 1,
      agent: {
        name: "my-agent",
        consumer: "agent",
        description: "Data processing agent",
        capabilities: ["read", "write"],
        expires: "2025-12-31",
        services: ["postgres", "redis"],
        identity: "keys/agent.age",
        recipient: "age1abc123",
      },
      secret: {
        DB_PASSWORD: {
          service: "postgres",
          purpose: "Database authentication",
          capabilities: ["read", "write"],
          created: "2025-01-01",
          expires: "2025-12-31",
          rotation_url: "https://admin.example.com/rotate",
          rotates: "90d",
          rate_limit: "1000/min",
          model_hint: "gpt-4",
          source: "vault",
          required: true,
          tags: { env: "production", priority: "critical" },
        },
      },
      lifecycle: {
        stale_warning_days: 90,
        require_expiration: true,
        require_service: true,
      },
      callbacks: {
        on_expiring: "notify-slack",
        on_expired: "alert-pagerduty",
        on_audit_fail: "log-to-siem",
      },
      tools: {
        fnox: true,
        mcp: true,
        custom_tool: { enabled: true },
      },
    }
    expect(configChecker.Check(config)).toBe(true)
  })

  it("rejects config without version", () => {
    const config = { secret: { API_KEY: { service: "example" } } }
    expect(configChecker.Check(config)).toBe(false)
  })

  it("accepts config without secret (optional)", () => {
    const config = { version: 1 }
    expect(configChecker.Check(config)).toBe(true)
  })
})

describe("SecretMetaSchema", () => {
  it("validates empty secret meta (all fields optional)", () => {
    expect(secretMetaChecker.Check({})).toBe(true)
  })

  it("validates secret meta with service", () => {
    expect(secretMetaChecker.Check({ service: "postgres" })).toBe(true)
  })

  it("validates full secret meta with v5 fields", () => {
    const meta = {
      service: "stripe",
      purpose: "Payment processing",
      capabilities: ["charge", "refund"],
      created: "2025-01-01",
      expires: "2025-12-31",
      rotation_url: "https://dashboard.stripe.com/apikeys",
      rotates: "quarterly",
      rate_limit: "100/sec",
      model_hint: "claude-3",
      source: "manual",
      required: true,
      tags: { category: "billing" },
    }
    expect(secretMetaChecker.Check(meta)).toBe(true)
  })

  it("rejects tags as array (now must be Record<string,string>)", () => {
    const meta = { tags: ["billing"] }
    expect(secretMetaChecker.Check(meta)).toBe(false)
  })

  it("accepts comment field", () => {
    const meta = { service: "stripe", comment: "Rotated by ops team on Mondays" }
    expect(secretMetaChecker.Check(meta)).toBe(true)
  })
})

describe("EnvMetaSchema", () => {
  it("validates minimal env meta", () => {
    expect(envMetaChecker.Check({ value: "production" })).toBe(true)
  })

  it("accepts comment field", () => {
    const meta = { value: "info", purpose: "Log level", comment: "Set to debug for troubleshooting" }
    expect(envMetaChecker.Check(meta)).toBe(true)
  })

  it("validates full env meta with tags and comment", () => {
    const meta = {
      value: "production",
      purpose: "Runtime mode",
      comment: "Override in staging",
      tags: { env: "prod" },
    }
    expect(envMetaChecker.Check(meta)).toBe(true)
  })
})

describe("AgentIdentitySchema", () => {
  it("validates minimal agent", () => {
    expect(agentChecker.Check({ name: "test-agent" })).toBe(true)
  })

  it("validates full agent with v5 fields", () => {
    const agent = {
      name: "data-processor",
      consumer: "agent",
      description: "ETL pipeline processor",
      capabilities: ["read-db", "write-s3"],
      expires: "2026-01-01",
      services: ["postgres", "s3"],
      identity: "keys/agent.age",
      recipient: "age1xyz",
    }
    expect(agentChecker.Check(agent)).toBe(true)
  })

  it("rejects agent without name", () => {
    expect(agentChecker.Check({})).toBe(false)
  })

  it("rejects invalid consumer type", () => {
    expect(agentChecker.Check({ name: "test", consumer: "invalid" })).toBe(false)
  })

  it("validates all consumer types", () => {
    for (const consumer of ["agent", "service", "developer", "ci"]) {
      expect(agentChecker.Check({ name: "test", consumer })).toBe(true)
    }
  })
})
