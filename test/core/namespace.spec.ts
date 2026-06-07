import { describe, expect, it } from "vitest"

import { displayName, isShellSafeSeparator, makeEnvNamer } from "../../src/core/namespace.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const cfg = (namespace?: EnvpktConfig["namespace"]): EnvpktConfig => ({ version: 1, namespace })

describe("makeEnvNamer", () => {
  it("returns the logical key unchanged when no namespace is configured", () => {
    const namer = makeEnvNamer(cfg())
    expect(namer("API_KEY")).toBe("API_KEY")
  })

  it("prefixes with the file-level namespace and default '__' separator", () => {
    const namer = makeEnvNamer(cfg({ prefix: "CIV" }))
    expect(namer("API_KEY")).toBe("CIV__API_KEY")
  })

  it("uses a custom separator when provided", () => {
    const namer = makeEnvNamer(cfg({ prefix: "CIV", separator: "_" }))
    expect(namer("API_KEY")).toBe("CIV_API_KEY")
  })

  it("lets a per-entry namespace override the file-level prefix", () => {
    const namer = makeEnvNamer(cfg({ prefix: "CIV" }))
    expect(namer("LEGACY_KEY", "OLD")).toBe("OLD__LEGACY_KEY")
  })

  it("treats an empty per-entry namespace as an explicit opt-out", () => {
    const namer = makeEnvNamer(cfg({ prefix: "CIV" }))
    expect(namer("SHARED_TOKEN", "")).toBe("SHARED_TOKEN")
  })

  it("inherits the file-level separator for per-entry overrides", () => {
    const namer = makeEnvNamer(cfg({ prefix: "CIV", separator: "_" }))
    expect(namer("LEGACY_KEY", "OLD")).toBe("OLD_LEGACY_KEY")
  })

  it("applies a per-entry namespace even when no file-level prefix exists", () => {
    const namer = makeEnvNamer(cfg())
    expect(namer("LEGACY_KEY", "OLD")).toBe("OLD__LEGACY_KEY")
  })
})

describe("displayName", () => {
  it("returns the logical key unchanged when no namespace is configured", () => {
    expect(displayName(cfg(), "API_KEY")).toBe("API_KEY")
  })

  it("renders the dotted form regardless of the wire separator", () => {
    expect(displayName(cfg({ prefix: "CIV", separator: "__" }), "API_KEY")).toBe("CIV.API_KEY")
  })

  it("honors a per-entry override in the dotted display form", () => {
    expect(displayName(cfg({ prefix: "CIV" }), "LEGACY_KEY", "OLD")).toBe("OLD.LEGACY_KEY")
  })

  it("opts out of the dotted prefix for an empty per-entry namespace", () => {
    expect(displayName(cfg({ prefix: "CIV" }), "SHARED_TOKEN", "")).toBe("SHARED_TOKEN")
  })
})

describe("isShellSafeSeparator", () => {
  it("accepts underscore separators", () => {
    expect(isShellSafeSeparator("__")).toBe(true)
    expect(isShellSafeSeparator("_")).toBe(true)
  })

  it("accepts alphanumeric separators", () => {
    expect(isShellSafeSeparator("X")).toBe(true)
  })

  it("rejects a dot separator", () => {
    expect(isShellSafeSeparator(".")).toBe(false)
  })

  it("rejects a colon separator", () => {
    expect(isShellSafeSeparator(":")).toBe(false)
  })

  it("rejects an empty separator", () => {
    expect(isShellSafeSeparator("")).toBe(false)
  })
})
