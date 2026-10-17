import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/fnox/detect.js", () => ({ fnoxAvailable: () => false }))

// Answers the prompt layer receives, keyed by the question it asks.
const promptAnswers: Record<string, string> = {}
vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (answer: string) => void) => cb(promptAnswers[q] ?? ""),
    close: () => undefined,
  }),
}))

import { resolveValues } from "../../src/core/resolve-values.js"

const KEYS = [
  "ENVPKT_TEST_NL",
  "ENVPKT_TEST_CRLF",
  "ENVPKT_TEST_TWO_NL",
  "ENVPKT_TEST_PADDED",
  "ENVPKT_TEST_ONLY_NL",
  "ENVPKT_TEST_BLANK",
]

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

  it("treats an env var holding only a newline or whitespace as unset", async () => {
    process.env["ENVPKT_TEST_ONLY_NL"] = "\n"
    process.env["ENVPKT_TEST_BLANK"] = "  \t \n"

    expect(await resolveValues(["ENVPKT_TEST_ONLY_NL", "ENVPKT_TEST_BLANK"])).toEqual({})
  })
})

describe("resolveValues prompt layer", () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true })
    Object.keys(promptAnswers).forEach((q) => {
      delete promptAnswers[q]
    })
  })

  it("keeps a typed value as typed and skips an empty or whitespace-only answer", async () => {
    promptAnswers["Enter value for ENVPKT_PROMPT_VALUE: "] = "  typed\t"
    promptAnswers["Enter value for ENVPKT_PROMPT_EMPTY: "] = ""
    promptAnswers["Enter value for ENVPKT_PROMPT_BLANK: "] = "   "

    const values = await resolveValues(["ENVPKT_PROMPT_VALUE", "ENVPKT_PROMPT_EMPTY", "ENVPKT_PROMPT_BLANK"])

    expect(values).toEqual({ ENVPKT_PROMPT_VALUE: "  typed\t" })
  })
})
