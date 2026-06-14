import { describe, expect, it } from "vitest"

import { diffConfigs } from "../../src/core/diff.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const cfg = (partial: Partial<EnvpktConfig>): EnvpktConfig => ({ version: 1, ...partial })

describe("diffConfigs", () => {
  it("reports identical configs", () => {
    const a = cfg({ secret: { API_KEY: { service: "stripe" } } })
    const b = cfg({ secret: { API_KEY: { service: "stripe" } } })
    const d = diffConfigs(a, b)
    expect(d.identical).toBe(true)
    expect(d.secret.onlyA).toEqual([])
    expect(d.secret.onlyB).toEqual([])
    expect(d.secret.changed).toEqual([])
  })

  it("reports keys only in A (removed) and only in B (added), sorted", () => {
    const a = cfg({ secret: { OLD: { service: "x" }, KEEP: { service: "x" } } })
    const b = cfg({ secret: { KEEP: { service: "x" }, NEW: { service: "y" }, ALSO_NEW: { service: "z" } } })
    const d = diffConfigs(a, b)
    expect(d.identical).toBe(false)
    expect(d.secret.onlyA).toEqual(["OLD"])
    expect(d.secret.onlyB).toEqual(["ALSO_NEW", "NEW"])
  })

  it("reports field-level metadata changes for shared keys", () => {
    const a = cfg({ secret: { API_KEY: { service: "stripe", expires: "2026-01-01", capabilities: ["read"] } } })
    const b = cfg({
      secret: { API_KEY: { service: "stripe", expires: "2027-01-01", capabilities: ["read", "write"] } },
    })
    const d = diffConfigs(a, b)
    expect(d.secret.changed).toHaveLength(1)
    const change = d.secret.changed[0]!
    expect(change.key).toBe("API_KEY")
    const fields = Object.fromEntries(change.changes.map((c) => [c.field, [c.a, c.b]]))
    expect(fields["expires"]).toEqual(["2026-01-01", "2027-01-01"])
    expect(fields["capabilities"]).toEqual(['["read"]', '["read","write"]'])
    expect(fields["service"]).toBeUndefined() // unchanged → not reported
  })

  it("ignores encrypted_value ciphertext but reports a sealed-status change", () => {
    const a = cfg({ secret: { K: { service: "x", encrypted_value: "AAA...ciphertext-one" } } })
    const b = cfg({ secret: { K: { service: "x", encrypted_value: "BBB...ciphertext-two" } } })
    // Same sealed status, different ciphertext → NOT a change.
    expect(diffConfigs(a, b).identical).toBe(true)

    const unsealed = cfg({ secret: { K: { service: "x" } } })
    const d = diffConfigs(unsealed, a)
    const sealed = d.secret.changed[0]!.changes.find((c) => c.field === "sealed")
    expect(sealed).toEqual({ field: "sealed", a: "no", b: "yes" })
  })

  it("diffs env entries too (including value)", () => {
    const a = cfg({ env: { LOG_LEVEL: { value: "info" } } })
    const b = cfg({ env: { LOG_LEVEL: { value: "debug" }, PORT: { value: "3000" } } })
    const d = diffConfigs(a, b)
    expect(d.env.onlyB).toEqual(["PORT"])
    const valChange = d.env.changed[0]!.changes.find((c) => c.field === "value")
    expect(valChange).toEqual({ field: "value", a: "info", b: "debug" })
  })
})
