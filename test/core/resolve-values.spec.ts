import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/fnox/detect.js", () => ({ fnoxAvailable: () => false }))

import { resolveValues } from "../../src/core/resolve-values.js"

const KEYS = ["ENVPKT_TEST_NL", "ENVPKT_TEST_CRLF", "ENVPKT_TEST_TWO_NL", "ENVPKT_TEST_PADDED", "ENVPKT_TEST_ONLY_NL"]

describe("resolveValues env layer", () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    // No terminal, so the prompt layer never runs.
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true })
    KEYS.forEach((k) => {
      delete process.env[k]
    })
  })

  it("strips one trailing newline and keeps everything else", async () => {
    process.env["ENVPKT_TEST_NL"] = "tok\n"
    process.env["ENVPKT_TEST_CRLF"] = "tok\r\n"
    process.env["ENVPKT_TEST_TWO_NL"] = "tok\n\n"
    process.env["ENVPKT_TEST_PADDED"] = "  tok\t"

    const values = await resolveValues(KEYS.slice(0, 4))

    expect(values).toEqual({
      ENVPKT_TEST_NL: "tok",
      ENVPKT_TEST_CRLF: "tok",
      ENVPKT_TEST_TWO_NL: "tok\n",
      ENVPKT_TEST_PADDED: "  tok\t",
    })
  })

  it("treats an env var holding only a newline as unset", async () => {
    process.env["ENVPKT_TEST_ONLY_NL"] = "\n"

    expect(await resolveValues(["ENVPKT_TEST_ONLY_NL"])).toEqual({})
  })
})
