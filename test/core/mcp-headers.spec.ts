import { describe, expect, it } from "vitest"

import { buildMcpHeaders, formatMcpHeadersError, validateMcpHeaders } from "../../src/core/mcp-headers.js"
import type { EnvpktConfig } from "../../src/core/types.js"
import { validateRawConfig } from "../../src/core/validate.js"

const config = (secret: EnvpktConfig["secret"]): EnvpktConfig => ({ version: 1, secret })

describe("buildMcpHeaders", () => {
  it("defaults to Authorization: Bearer <value>", () => {
    const cfg = config({ GH_KEY: { mcp: [{ server: "github" }] } })
    const result = buildMcpHeaders(cfg, { GH_KEY: "abc" }, "github")
    expect(result.orThrow()).toEqual({ Authorization: "Bearer abc" })
  })

  it("sends the raw value when scheme is empty", () => {
    const cfg = config({ CF_KEY: { mcp: [{ server: "cloudflare", header: "x-api-key", scheme: "" }] } })
    expect(buildMcpHeaders(cfg, { CF_KEY: "raw" }, "cloudflare").orThrow()).toEqual({ "x-api-key": "raw" })
  })

  it("merges every secret that names the server into one object", () => {
    const cfg = config({
      TOKEN: { mcp: [{ server: "corpus" }] },
      TENANT: { mcp: [{ server: "corpus", header: "x-tenant", scheme: "" }, { server: "other" }] },
      UNRELATED: { mcp: [{ server: "other", header: "x-other" }] },
    })
    const result = buildMcpHeaders(cfg, { TOKEN: "t", TENANT: "acme", UNRELATED: "u" }, "corpus")
    expect(result.orThrow()).toEqual({ Authorization: "Bearer t", "x-tenant": "acme" })
  })

  it("fails naming the server when no secret declares it", () => {
    const cfg = config({ GH_KEY: { mcp: [{ server: "github" }] } })
    expectLeft(buildMcpHeaders(cfg, { GH_KEY: "abc" }, "nope"), (msg) => expect(msg).toContain('"nope"'))
  })

  it("ignores problems on other servers", () => {
    const cfg = config({
      GOOD: { mcp: [{ server: "fine" }] },
      A: { mcp: [{ server: "broken" }] },
      B: { mcp: [{ server: "broken" }] },
    })
    expect(buildMcpHeaders(cfg, { GOOD: "g", A: "a", B: "b" }, "fine").orThrow()).toEqual({ Authorization: "Bearer g" })
    expectLeft(buildMcpHeaders(cfg, { GOOD: "g", A: "a", B: "b" }, "broken"), (msg) =>
      expect(msg).toContain('"broken"'),
    )
  })

  it("treats an empty value as unresolved", () => {
    const cfg = config({ GH_KEY: { mcp: [{ server: "github" }] } })
    expectLeft(buildMcpHeaders(cfg, { GH_KEY: "" }, "github"), (msg) => expect(msg).toContain("no value resolved"))
  })

  it("rejects a value with a line break without echoing the value", () => {
    const cfg = config({ CERT: { mcp: [{ server: "s", header: "x-cert", scheme: "" }] } })
    expectLeft(buildMcpHeaders(cfg, { CERT: "line1\nsecret-part" }, "s"), (msg) => {
      expect(msg).toContain("CERT")
      expect(msg).not.toContain("secret-part")
    })
  })

  it("fails naming the server and key when a value did not resolve", () => {
    const cfg = config({ GH_KEY: { mcp: [{ server: "github" }] } })
    expectLeft(buildMcpHeaders(cfg, {}, "github"), (msg) => {
      expect(msg).toContain('"github"')
      expect(msg).toContain("GH_KEY")
    })
  })
})

describe("validateMcpHeaders", () => {
  it("rejects two secrets claiming the same (server, header), case-insensitively", () => {
    const cfg = config({
      A: { mcp: [{ server: "github" }] },
      B: { mcp: [{ server: "github", header: "authorization" }] },
    })
    expectLeft(validateMcpHeaders(cfg), (msg) => {
      expect(msg).toContain("A, B")
    })
  })

  it("allows the same header on different servers", () => {
    const cfg = config({ A: { mcp: [{ server: "one" }] }, B: { mcp: [{ server: "two" }] } })
    expect(validateMcpHeaders(cfg).isRight()).toBe(true)
  })

  it("rejects a header name that is not an HTTP token", () => {
    for (const header of ["  ", "x api key", "x-key:"]) {
      const cfg = config({ A: { mcp: [{ server: "one", header }] } })
      expectLeft(validateMcpHeaders(cfg), (msg) => expect(msg).toContain("not a valid HTTP header name"))
    }
  })

  it("rejects a multi-word scheme but allows the empty raw-value scheme", () => {
    const bad = config({ A: { mcp: [{ server: "one", scheme: "Bearer token" }] } })
    expectLeft(validateMcpHeaders(bad), (msg) => expect(msg).toContain("scheme"))
    const raw = config({ A: { mcp: [{ server: "one", header: "x-api-key", scheme: "" }] } })
    expect(validateMcpHeaders(raw).isRight()).toBe(true)
  })

  it("names each secret once when one secret lists the same server twice", () => {
    const cfg = config({ A: { mcp: [{ server: "one" }, { server: "one" }] } })
    expectLeft(validateMcpHeaders(cfg), (msg) => expect(msg).toMatch(/binding: A$/))
  })

  it("runs as part of validateRawConfig (the write gate)", () => {
    const raw = `version = 1\n\n[secret.A]\nmcp = [{ server = "s" }]\n\n[secret.B]\nmcp = [{ server = "s" }]\n`
    expect(validateRawConfig(raw).isLeft()).toBe(true)
  })

  it("schema rejects an empty header name", () => {
    const raw = `version = 1\n\n[secret.A]\nmcp = [{ server = "s", header = "" }]\n`
    expect(validateRawConfig(raw).isLeft()).toBe(true)
  })
})

/** Assert Left and hand its formatted message to `check`. */
const expectLeft = (
  either: ReturnType<typeof validateMcpHeaders> | ReturnType<typeof buildMcpHeaders>,
  check: (msg: string) => void,
): void => {
  expect(either.isLeft()).toBe(true)
  either.fold(
    (err) => check(formatMcpHeadersError(err)),
    () => undefined,
  )
}
