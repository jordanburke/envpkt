import { describe, expect, it } from "vitest"
import { TypeCompiler } from "@sinclair/typebox/compiler"
import { EnvpktConfigSchema, SecretMetaSchema, AgentIdentitySchema } from "../../src/core/schema.js"

const configChecker = TypeCompiler.Compile(EnvpktConfigSchema)
const secretMetaChecker = TypeCompiler.Compile(SecretMetaSchema)
const agentChecker = TypeCompiler.Compile(AgentIdentitySchema)

describe("EnvpktConfigSchema", () => {
  it("validates a minimal config", () => {
    const config = {
      version: 1,
      meta: {
        API_KEY: { service: "example" },
      },
    }
    expect(configChecker.Check(config)).toBe(true)
  })

  it("validates a full config", () => {
    const config = {
      version: 1,
      agent: {
        name: "my-agent",
        role: "data-processor",
        capabilities: ["read", "write"],
        expires: "2025-12-31",
      },
      meta: {
        DB_PASSWORD: {
          service: "postgres",
          consumer: "database",
          env_var: "DB_PASSWORD",
          vault_path: "/secrets/db",
          purpose: "Database authentication",
          capabilities: ["read", "write"],
          created: "2025-01-01",
          expires: "2025-12-31",
          rotation_url: "https://admin.example.com/rotate",
          provisioner: "vault",
          tags: ["production", "critical"],
        },
      },
      lifecycle: {
        warn_before_days: 30,
        stale_after_days: 365,
        require_rotation_url: true,
        require_purpose: true,
      },
      callbacks: {
        on_expiring: "notify-slack",
        on_expired: "alert-pagerduty",
        on_audit_fail: "log-to-siem",
      },
      tools: {
        fnox: true,
        mcp: true,
      },
    }
    expect(configChecker.Check(config)).toBe(true)
  })

  it("rejects config without version", () => {
    const config = { meta: { API_KEY: { service: "example" } } }
    expect(configChecker.Check(config)).toBe(false)
  })

  it("rejects config without meta", () => {
    const config = { version: 1 }
    expect(configChecker.Check(config)).toBe(false)
  })

  it("rejects meta entry without service", () => {
    const config = {
      version: 1,
      meta: { API_KEY: {} },
    }
    expect(configChecker.Check(config)).toBe(false)
  })

  it("rejects invalid consumer type", () => {
    const meta = { service: "example", consumer: "invalid" }
    expect(secretMetaChecker.Check(meta)).toBe(false)
  })

  it("rejects invalid provisioner", () => {
    const meta = { service: "example", provisioner: "unknown" }
    expect(secretMetaChecker.Check(meta)).toBe(false)
  })
})

describe("SecretMetaSchema", () => {
  it("validates minimal secret meta", () => {
    expect(secretMetaChecker.Check({ service: "postgres" })).toBe(true)
  })

  it("validates full secret meta", () => {
    const meta = {
      service: "stripe",
      consumer: "api",
      env_var: "STRIPE_KEY",
      vault_path: "/secrets/stripe",
      purpose: "Payment processing",
      capabilities: ["charge", "refund"],
      created: "2025-01-01",
      expires: "2025-12-31",
      rotation_url: "https://dashboard.stripe.com/apikeys",
      provisioner: "manual",
      tags: ["billing"],
    }
    expect(secretMetaChecker.Check(meta)).toBe(true)
  })
})

describe("AgentIdentitySchema", () => {
  it("validates minimal agent", () => {
    expect(agentChecker.Check({ name: "test-agent" })).toBe(true)
  })

  it("validates full agent", () => {
    const agent = {
      name: "data-processor",
      role: "ETL pipeline",
      capabilities: ["read-db", "write-s3"],
      expires: "2026-01-01",
    }
    expect(agentChecker.Check(agent)).toBe(true)
  })

  it("rejects agent without name", () => {
    expect(agentChecker.Check({})).toBe(false)
  })
})
