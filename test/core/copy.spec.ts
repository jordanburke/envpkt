import { Option } from "functype"
import { parse } from "smol-toml"
import { describe, expect, it } from "vitest"

import { copyableSecretMeta, serializeEnvBlock, serializeSecretBlock } from "../../src/core/copy.js"
import type { SecretMeta } from "../../src/core/types.js"

describe("serializeSecretBlock", () => {
  it("round-trips all metadata fields through the TOML parser", () => {
    const meta: SecretMeta = {
      service: "stripe",
      purpose: "billing",
      created: "2025-01-01",
      expires: "2026-01-01",
      required: true,
      capabilities: ["read", "write"],
      tags: { team: "core", env: "prod" },
    }
    const parsed = parse(serializeSecretBlock("API_KEY", meta)) as { secret: Record<string, SecretMeta> }
    const out = parsed.secret.API_KEY!
    expect(out.service).toBe("stripe")
    expect(out.purpose).toBe("billing")
    expect(out.created).toBe("2025-01-01")
    expect(out.expires).toBe("2026-01-01")
    expect(out.required).toBe(true)
    expect(out.capabilities).toEqual(["read", "write"])
    expect(out.tags).toEqual({ team: "core", env: "prod" })
  })

  it("emits a triple-quoted encrypted_value that parses back", () => {
    const parsed = parse(serializeSecretBlock("X", { encrypted_value: "CIPHERTEXT" })) as {
      secret: Record<string, SecretMeta>
    }
    expect(parsed.secret.X!.encrypted_value!.trim()).toBe("CIPHERTEXT")
  })

  it("escapes double quotes and backslashes in string values", () => {
    const parsed = parse(serializeSecretBlock("X", { purpose: 'has "quotes" and \\slash' })) as {
      secret: Record<string, SecretMeta>
    }
    expect(parsed.secret.X!.purpose).toBe('has "quotes" and \\slash')
  })

  it("omits fields that are not present", () => {
    const block = serializeSecretBlock("X", { service: "only" })
    expect(block).toContain('service = "only"')
    expect(block).not.toContain("purpose")
    expect(block).not.toContain("encrypted_value")
  })
})

describe("serializeEnvBlock", () => {
  it("round-trips value and metadata", () => {
    const parsed = parse(serializeEnvBlock("PORT", { value: "3000", purpose: "app port", tags: { team: "core" } })) as {
      env: Record<string, { value?: string; purpose?: string; tags?: Record<string, string> }>
    }
    const out = parsed.env.PORT!
    expect(out.value).toBe("3000")
    expect(out.purpose).toBe("app port")
    expect(out.tags).toEqual({ team: "core" })
  })
})

describe("copyableSecretMeta", () => {
  const source: SecretMeta = {
    service: "stripe",
    created: "2020-01-01",
    last_rotated_at: "2024-06-01",
    encrypted_value: "OLD_CIPHER",
  }

  it("resets created to today and drops last_rotated_at", () => {
    const out = copyableSecretMeta(source, { today: "2026-06-18", encryptedValue: Option.none<string>() })
    expect(out.created).toBe("2026-06-18")
    expect(out.last_rotated_at).toBeUndefined()
    expect(out.service).toBe("stripe")
  })

  it("sets the resealed ciphertext when given Some", () => {
    const out = copyableSecretMeta(source, { today: "2026-06-18", encryptedValue: Option("NEW_CIPHER") })
    expect(out.encrypted_value).toBe("NEW_CIPHER")
  })

  it("strips encrypted_value when given None (metadata-only copy)", () => {
    const out = copyableSecretMeta(source, { today: "2026-06-18", encryptedValue: Option.none<string>() })
    expect(out.encrypted_value).toBeUndefined()
  })
})
