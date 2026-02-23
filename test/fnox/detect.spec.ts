import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { detectFnox } from "../../src/fnox/detect.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-fnox-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("detectFnox", () => {
  it("returns Some when fnox.toml exists", () => {
    writeFileSync(join(tmpDir, "fnox.toml"), "[KEY]\nvalue = 'test'\n")
    const result = detectFnox(tmpDir)
    expect(result.isSome()).toBe(true)
    result.fold(
      () => expect.unreachable("Expected Some"),
      (path) => expect(path).toBe(join(tmpDir, "fnox.toml")),
    )
  })

  it("returns None when fnox.toml does not exist", () => {
    const result = detectFnox(tmpDir)
    expect(result.isNone()).toBe(true)
  })
})
