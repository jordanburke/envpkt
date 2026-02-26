import { describe, expect, it } from "vitest"

import { formatPacket, maskValue } from "../../src/core/format.js"
import type { FormatPacketOptions } from "../../src/core/format.js"
import { makeResult } from "../fixtures/demo-data.js"

describe("formatPacket", () => {
  it("formats a minimal standalone config", () => {
    const result = makeResult({
      version: 1,
      meta: { API_KEY: { service: "openai" } },
    })
    const output = formatPacket(result)

    expect(output).toContain("envpkt packet")
    expect(output).toContain("secrets: 1")
    expect(output).toContain("API_KEY → openai")
    expect(output).not.toContain("catalog:")
  })

  it("formats agent header with consumer type", () => {
    const result = makeResult({
      version: 1,
      agent: { name: "api-gateway", consumer: "service", description: "REST API server" },
      meta: {},
    })
    const output = formatPacket(result)

    expect(output).toContain("envpkt packet: api-gateway (service)")
    expect(output).toContain("REST API server")
  })

  it("formats agent capabilities", () => {
    const result = makeResult({
      version: 1,
      agent: { name: "bot", capabilities: ["http:serve", "payments:process"] },
      meta: {},
    })
    const output = formatPacket(result)

    expect(output).toContain("capabilities: http:serve, payments:process")
  })

  it("formats all secret metadata tiers", () => {
    const result = makeResult({
      version: 1,
      meta: {
        DATABASE_URL: {
          service: "postgres",
          purpose: "Primary database",
          capabilities: ["SELECT", "INSERT"],
          created: "2026-01-15",
          expires: "2027-01-15",
          rotates: "90d",
          rate_limit: "1000/min",
          source: "vault",
          model_hint: "gpt-4",
          rotation_url: "https://wiki.internal/rotate-db",
          required: true,
          tags: { env: "production", team: "platform" },
        },
      },
    })
    const output = formatPacket(result)

    expect(output).toContain("DATABASE_URL → postgres")
    expect(output).toContain("purpose: Primary database")
    expect(output).toContain("capabilities: SELECT, INSERT")
    expect(output).toContain("created: 2026-01-15")
    expect(output).toContain("expires: 2027-01-15")
    expect(output).toContain("rotates: 90d")
    expect(output).toContain("rate_limit: 1000/min")
    expect(output).toContain("source: vault")
    expect(output).toContain("model_hint: gpt-4")
    expect(output).toContain("rotation_url: https://wiki.internal/rotate-db")
    expect(output).toContain("required: true")
    expect(output).toContain("tags: env=production, team=platform")
  })

  it("combines date fields on one line", () => {
    const result = makeResult({
      version: 1,
      meta: {
        KEY: { created: "2026-01-01", expires: "2027-01-01" },
      },
    })
    const output = formatPacket(result)

    expect(output).toContain("created: 2026-01-01  expires: 2027-01-01")
  })

  it("combines operational fields on one line", () => {
    const result = makeResult({
      version: 1,
      meta: {
        KEY: { rotates: "30d", rate_limit: "500/sec" },
      },
    })
    const output = formatPacket(result)

    expect(output).toContain("rotates: 30d  rate_limit: 500/sec")
  })

  it("uses key name when service is absent", () => {
    const result = makeResult({
      version: 1,
      meta: { MY_SECRET: {} },
    })
    const output = formatPacket(result)

    expect(output).toContain("MY_SECRET → MY_SECRET")
  })

  it("formats lifecycle section", () => {
    const result = makeResult({
      version: 1,
      meta: {},
      lifecycle: { stale_warning_days: 90, require_expiration: true, require_service: false },
    })
    const output = formatPacket(result)

    expect(output).toContain("lifecycle:")
    expect(output).toContain("stale_warning_days: 90")
    expect(output).toContain("require_expiration: true")
    expect(output).toContain("require_service: false")
  })

  it("formats catalog resolution summary", () => {
    const result = makeResult(
      {
        version: 1,
        meta: { DB: { service: "pg" }, REDIS: { service: "redis" } },
      },
      {
        catalogPath: "/infra/envpkt.toml",
        merged: ["DB", "REDIS"],
        overridden: ["DB"],
        warnings: [],
      },
    )
    const output = formatPacket(result)

    expect(output).toContain("catalog: /infra/envpkt.toml")
    expect(output).toContain("merged: 2 keys")
    expect(output).toContain("overridden: DB")
  })

  it("shows (none) for no overrides", () => {
    const result = makeResult(
      { version: 1, meta: { KEY: { service: "svc" } } },
      {
        catalogPath: "/catalog.toml",
        merged: ["KEY"],
        overridden: [],
      },
    )
    const output = formatPacket(result)

    expect(output).toContain("overridden: (none)")
  })

  it("shows catalog warnings", () => {
    const result = makeResult(
      { version: 1, meta: {} },
      {
        catalogPath: "/catalog.toml",
        merged: [],
        overridden: [],
        warnings: ["KEY is deprecated"],
      },
    )
    const output = formatPacket(result)

    expect(output).toContain("warning: KEY is deprecated")
  })

  it("omits catalog section when no catalog was used", () => {
    const result = makeResult({ version: 1, meta: {} })
    const output = formatPacket(result)

    expect(output).not.toContain("catalog:")
  })

  describe("secret value display", () => {
    const secretResult = makeResult({
      version: 1,
      meta: {
        DATABASE_URL: { service: "postgres" },
        SHORT_KEY: { service: "svc" },
      },
    })

    const secrets: Record<string, string> = {
      DATABASE_URL: "postgres://user:pass@host:5432/mydb",
      SHORT_KEY: "abc",
    }

    it("masks long values in encrypted mode (first 3 + ••••• + last 4)", () => {
      const output = formatPacket(secretResult, { secrets })
      expect(output).toContain("DATABASE_URL → postgres = pos•••••mydb")
    })

    it("fully masks short values (≤8 chars) in encrypted mode", () => {
      const output = formatPacket(secretResult, { secrets })
      expect(output).toContain("SHORT_KEY → svc = •••••")
    })

    it("defaults to encrypted when secrets are provided without secretDisplay", () => {
      const output = formatPacket(secretResult, { secrets })
      expect(output).not.toContain("postgres://user:pass@host:5432/mydb")
      expect(output).toContain("pos•••••mydb")
    })

    it("shows full value in plaintext mode", () => {
      const opts: FormatPacketOptions = { secrets, secretDisplay: "plaintext" }
      const output = formatPacket(secretResult, opts)
      expect(output).toContain("DATABASE_URL → postgres = postgres://user:pass@host:5432/mydb")
      expect(output).toContain("SHORT_KEY → svc = abc")
    })

    it("shows no value when key is missing from secrets map", () => {
      const partial: FormatPacketOptions = { secrets: { DATABASE_URL: "some-long-value" } }
      const output = formatPacket(secretResult, partial)
      expect(output).toContain("DATABASE_URL → postgres = som•••••alue")
      expect(output).toMatch(/SHORT_KEY → svc\n|SHORT_KEY → svc$/)
    })

    it("shows no values when no options are provided (backward compat)", () => {
      const output = formatPacket(secretResult)
      expect(output).not.toContain("=")
      expect(output).toContain("DATABASE_URL → postgres")
    })
  })

  describe("maskValue", () => {
    it("masks long values: first 3 + ••••• + last 4", () => {
      expect(maskValue("postgres://user:pass@host:5432/mydb")).toBe("pos•••••mydb")
    })

    it("masks exactly 9 char value", () => {
      expect(maskValue("123456789")).toBe("123•••••6789")
    })

    it("fully masks 8 char value", () => {
      expect(maskValue("12345678")).toBe("•••••")
    })

    it("fully masks short values", () => {
      expect(maskValue("abc")).toBe("•••••")
    })

    it("fully masks single char", () => {
      expect(maskValue("x")).toBe("•••••")
    })
  })

  it("contains no ANSI escape sequences", () => {
    const result = makeResult({
      version: 1,
      agent: { name: "test", consumer: "agent", description: "A test agent", capabilities: ["read"] },
      meta: {
        KEY: { service: "svc", purpose: "test", capabilities: ["read"], source: "vault" },
      },
      lifecycle: { stale_warning_days: 90 },
    })
    const output = formatPacket(result)

    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[/)
  })

  it("formats a full resolved packet with all sections", () => {
    const result: ResolveResult = {
      config: {
        version: 1,
        agent: {
          name: "api-gateway",
          consumer: "service",
          description: "REST API — handles payments and database writes",
          capabilities: ["http:serve", "payments:process"],
        },
        meta: {
          DATABASE_URL: {
            service: "postgres",
            purpose: "Primary application database",
            capabilities: ["SELECT", "INSERT", "UPDATE", "DELETE"],
            expires: "2027-01-15",
            rotates: "90d",
            source: "vault",
          },
          STRIPE_SECRET_KEY: {
            service: "stripe",
            purpose: "Payment processing",
            capabilities: ["charges:write", "subscriptions:read"],
            expires: "2027-02-01",
            rate_limit: "100/sec",
            source: "vault",
          },
        },
        lifecycle: { stale_warning_days: 90, require_expiration: true },
      },
      catalogPath: "/infra/envpkt.toml",
      merged: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
      overridden: [],
      warnings: [],
    }
    const output = formatPacket(result)

    expect(output).toContain("envpkt packet: api-gateway (service)")
    expect(output).toContain("secrets: 2")
    expect(output).toContain("DATABASE_URL → postgres")
    expect(output).toContain("STRIPE_SECRET_KEY → stripe")
    expect(output).toContain("lifecycle:")
    expect(output).toContain("catalog: /infra/envpkt.toml")
    expect(output).toContain("merged: 2 keys")
  })
})
