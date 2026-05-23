import { describe, expect, it } from "vitest"

import { formatValidationError, validateRawConfig } from "../../src/core/validate.js"

describe("validateRawConfig", () => {
  it("accepts a minimal valid config", () => {
    const raw = `version = 1
[secret.API_KEY]
service = "example"
`
    validateRawConfig(raw).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (config) => expect(config.secret?.["API_KEY"]?.service).toBe("example"),
    )
  })

  it("accepts a valid alias", () => {
    const raw = `version = 1
[secret.API_KEY]
service = "example"
[secret.LEGACY_API_KEY]
from_key = "secret.API_KEY"
`
    validateRawConfig(raw).fold(
      (err) => expect.unreachable(`expected Right, got ${err._tag}`),
      (config) => expect(config.secret?.["LEGACY_API_KEY"]?.from_key).toBe("secret.API_KEY"),
    )
  })

  it("rejects malformed TOML", () => {
    const raw = `version = 1
[secret.BROKEN
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("ParseError"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects wrong field type via schema", () => {
    // version must be a number; passing a string fails TypeBox validation
    const raw = `version = "one"
[secret.API_KEY]
service = "example"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("ValidationError"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects alias with missing target", () => {
    const raw = `version = 1
[secret.LEGACY]
from_key = "secret.MISSING"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("AliasTargetMissing"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects chained alias", () => {
    const raw = `version = 1
[secret.A]
service = "x"
[secret.B]
from_key = "secret.A"
[secret.C]
from_key = "secret.B"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("AliasChained"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects cross-type alias (secret pointing at env)", () => {
    const raw = `version = 1
[env.URL]
value = "https://x"
[secret.WRONG]
from_key = "env.URL"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("AliasCrossType"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects env alias that also declares a value", () => {
    const raw = `version = 1
[env.A]
value = "x"
[env.B]
value = "y"
from_key = "env.A"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("AliasValueConflict"),
      () => expect.unreachable("expected Left"),
    )
  })

  it("rejects self-referencing alias", () => {
    const raw = `version = 1
[secret.LOOP]
from_key = "secret.LOOP"
`
    validateRawConfig(raw).fold(
      (err) => expect(err._tag).toBe("AliasSelfReference"),
      () => expect.unreachable("expected Left"),
    )
  })
})

describe("formatValidationError", () => {
  it("formats parse errors", () => {
    const msg = formatValidationError({ _tag: "ParseError", message: "bad syntax" })
    expect(msg).toContain("TOML parse error")
    expect(msg).toContain("bad syntax")
  })

  it("formats alias errors via the alias formatter", () => {
    const msg = formatValidationError({
      _tag: "AliasTargetMissing",
      key: "secret.X",
      target: "secret.Y",
    })
    expect(msg).toContain("secret.X")
    expect(msg).toContain("not found")
  })
})
