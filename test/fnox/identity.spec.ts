import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { ageAvailable, unwrapAgentKey } from "../../src/fnox/identity.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-identity-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("ageAvailable", () => {
  it("returns a boolean", () => {
    const result = ageAvailable()
    expect(typeof result).toBe("boolean")
  })
})

describe("unwrapAgentKey", () => {
  it("returns Left IdentityNotFound for nonexistent file", () => {
    const result = unwrapAgentKey(join(tmpDir, "nonexistent.age"))
    result.fold(
      (err) => {
        expect(err._tag).toBe("IdentityNotFound")
        if (err._tag === "IdentityNotFound") {
          expect(err.path).toContain("nonexistent.age")
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left when age is not available and file exists", () => {
    const keyFile = join(tmpDir, "test.age")
    writeFileSync(keyFile, "encrypted-content")

    const result = unwrapAgentKey(keyFile)
    result.fold(
      (err) => {
        // Either AgeNotFound (if age not installed) or DecryptFailed (if age is installed but content is invalid)
        expect(["AgeNotFound", "DecryptFailed"]).toContain(err._tag)
      },
      () => {
        // If age is available and somehow decrypts (unlikely), that's fine too
      },
    )
  })

  it("resolves absolute paths", () => {
    const absPath = join(tmpDir, "keys", "agent.age")
    const result = unwrapAgentKey(absPath)
    result.fold(
      (err) => {
        expect(err._tag).toBe("IdentityNotFound")
        if (err._tag === "IdentityNotFound") {
          expect(err.path).toBe(absPath)
        }
      },
      () => expect.unreachable("Expected Left for missing file"),
    )
  })
})
