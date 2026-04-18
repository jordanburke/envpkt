import { describe, expect, it } from "vitest"

import { formatAliasError, validateAliases } from "../../src/core/alias.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const makeConfig = (overrides: Partial<EnvpktConfig> = {}): EnvpktConfig => ({
  version: 1,
  secret: {},
  env: {},
  ...overrides,
})

describe("validateAliases", () => {
  it("accepts a config with no aliases", () => {
    const config = makeConfig({
      secret: { API_KEY: { service: "example" } },
      env: { SERVICE_URL: { value: "https://x" } },
    })
    validateAliases(config).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (table) => expect(table.entries.size).toBe(0),
    )
  })

  it("accepts a valid secret alias", () => {
    const config = makeConfig({
      secret: {
        API_KEY: { service: "example" },
        LEGACY_API_KEY: { from_key: "secret.API_KEY" },
      },
    })
    validateAliases(config).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (table) => {
        expect(table.entries.size).toBe(1)
        const entry = table.entries.get("secret.LEGACY_API_KEY")
        expect(entry).toBeDefined()
        expect(entry?.targetKey).toBe("API_KEY")
        expect(entry?.kind).toBe("secret")
      },
    )
  })

  it("accepts a valid env alias", () => {
    const config = makeConfig({
      env: {
        SERVICE_URL: { value: "https://api.example.com" },
        LEGACY_URL: { from_key: "env.SERVICE_URL" },
      },
    })
    validateAliases(config).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (table) => {
        expect(table.entries.size).toBe(1)
        expect(table.entries.get("env.LEGACY_URL")?.targetKey).toBe("SERVICE_URL")
      },
    )
  })

  it("rejects missing target", () => {
    const config = makeConfig({
      secret: {
        ORPHAN: { from_key: "secret.MISSING" },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasTargetMissing")
        if (err._tag === "AliasTargetMissing") {
          expect(err.key).toBe("secret.ORPHAN")
          expect(err.target).toBe("secret.MISSING")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects self-reference", () => {
    const config = makeConfig({
      secret: {
        LOOP: { from_key: "secret.LOOP" },
      },
    })
    validateAliases(config).fold(
      (err) => expect(err._tag).toBe("AliasSelfReference"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects chained alias (A → B → C)", () => {
    const config = makeConfig({
      secret: {
        A: { service: "svc" },
        B: { from_key: "secret.A" },
        C: { from_key: "secret.B" },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasChained")
        if (err._tag === "AliasChained") {
          expect(err.key).toBe("secret.C")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects cross-type alias (secret → env)", () => {
    const config = makeConfig({
      secret: {
        FROM_ENV: { from_key: "env.SERVICE_URL" },
      },
      env: {
        SERVICE_URL: { value: "https://x" },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasCrossType")
        if (err._tag === "AliasCrossType") {
          expect(err.kind).toBe("secret")
          expect(err.targetKind).toBe("env")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects cross-type alias (env → secret)", () => {
    const config = makeConfig({
      secret: { API_KEY: { service: "svc" } },
      env: {
        FROM_SECRET: { from_key: "secret.API_KEY" },
      },
    })
    validateAliases(config).fold(
      (err) => expect(err._tag).toBe("AliasCrossType"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects invalid syntax", () => {
    const config = makeConfig({
      secret: {
        BAD: { from_key: "not-a-valid-ref" },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasInvalidSyntax")
        if (err._tag === "AliasInvalidSyntax") {
          expect(err.value).toBe("not-a-valid-ref")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects alias that also declares encrypted_value", () => {
    const config = makeConfig({
      secret: {
        TARGET: { service: "svc" },
        ALIAS: { from_key: "secret.TARGET", encrypted_value: "age:..." },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasValueConflict")
        if (err._tag === "AliasValueConflict") {
          expect(err.field).toBe("encrypted_value")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects env alias that also declares value", () => {
    const config = makeConfig({
      env: {
        TARGET: { value: "https://x" },
        ALIAS: { from_key: "env.TARGET", value: "https://nope" },
      },
    })
    validateAliases(config).fold(
      (err) => {
        expect(err._tag).toBe("AliasValueConflict")
        if (err._tag === "AliasValueConflict") {
          expect(err.field).toBe("value")
        }
      },
      () => expect.unreachable("expected Left"),
    )
  })

  it("allows alias with its own purpose metadata", () => {
    const config = makeConfig({
      secret: {
        API_KEY: { service: "example", purpose: "canonical" },
        LEGACY_API_KEY: { from_key: "secret.API_KEY", purpose: "legacy name" },
      },
    })
    validateAliases(config).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (table) => expect(table.entries.size).toBe(1),
    )
  })
})

describe("formatAliasError", () => {
  it("formats each variant with a clear message", () => {
    expect(formatAliasError({ _tag: "AliasInvalidSyntax", key: "X", kind: "secret", value: "bad" })).toContain("bad")
    expect(formatAliasError({ _tag: "AliasTargetMissing", key: "secret.X", target: "secret.Y" })).toContain("not found")
    expect(formatAliasError({ _tag: "AliasSelfReference", key: "secret.X" })).toContain("itself")
    expect(formatAliasError({ _tag: "AliasChained", key: "secret.X", target: "secret.Y" })).toContain("chained")
    expect(formatAliasError({ _tag: "AliasCrossType", key: "X", kind: "secret", targetKind: "env" })).toContain(
      "same-type",
    )
    expect(
      formatAliasError({ _tag: "AliasValueConflict", key: "X", kind: "secret", field: "encrypted_value" }),
    ).toContain("encrypted_value")
  })
})
