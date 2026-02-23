import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { findConfigPath, readConfigFile, parseToml, loadConfig, validateConfig } from "../../src/core/config.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("findConfigPath", () => {
  it("returns Some when envpkt.toml exists", () => {
    writeFileSync(join(tmpDir, "envpkt.toml"), "version = 1\n[meta]\n")
    const result = findConfigPath(tmpDir)
    expect(result.isSome()).toBe(true)
    result.fold(
      () => expect.unreachable("Expected Some"),
      (path) => expect(path).toBe(join(tmpDir, "envpkt.toml")),
    )
  })

  it("returns None when envpkt.toml does not exist", () => {
    const result = findConfigPath(tmpDir)
    expect(result.isNone()).toBe(true)
  })
})

describe("readConfigFile", () => {
  it("returns Right with file contents", () => {
    const content = 'version = 1\n[meta.KEY]\nservice = "test"\n'
    writeFileSync(join(tmpDir, "test.toml"), content)
    const result = readConfigFile(join(tmpDir, "test.toml"))
    result.fold(
      () => expect.unreachable("Expected Right"),
      (data) => expect(data).toBe(content),
    )
  })

  it("returns Left FileNotFound for missing file", () => {
    const result = readConfigFile(join(tmpDir, "nonexistent.toml"))
    result.fold(
      (err) => expect(err._tag).toBe("FileNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("parseToml", () => {
  it("parses valid TOML", () => {
    const result = parseToml('version = 1\n[meta.KEY]\nservice = "test"\n')
    result.fold(
      () => expect.unreachable("Expected Right"),
      (data) => {
        const obj = data as Record<string, unknown>
        expect(obj["version"]).toBe(1)
      },
    )
  })

  it("returns Left ParseError for invalid TOML", () => {
    const result = parseToml("this is not valid toml = [[[")
    result.fold(
      (err) => expect(err._tag).toBe("ParseError"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("converts TOML dates to ISO strings", () => {
    const result = parseToml('version = 1\n[meta.KEY]\nservice = "test"\ncreated = 2025-01-15\n')
    result.fold(
      () => expect.unreachable("Expected Right"),
      (data) => {
        const obj = data as { meta: { KEY: { created: string } } }
        expect(obj.meta.KEY.created).toBe("2025-01-15")
      },
    )
  })
})

describe("validateConfig", () => {
  it("returns Right for valid config", () => {
    const data = { version: 1, meta: { API_KEY: { service: "test" } } }
    const result = validateConfig(data)
    result.fold(
      () => expect.unreachable("Expected Right"),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.meta["API_KEY"]?.service).toBe("test")
      },
    )
  })

  it("returns Left ValidationError for missing required fields", () => {
    const data = { version: 1 }
    const result = validateConfig(data)
    result.fold(
      (err) => {
        expect(err._tag).toBe("ValidationError")
        if (err._tag === "ValidationError") {
          expect(err.errors.size).toBeGreaterThan(0)
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("loadConfig", () => {
  it("loads and validates a valid envpkt.toml", () => {
    const toml = `version = 1\n\n[meta.DB_PASS]\nservice = "postgres"\ncreated = 2025-01-01\n`
    const path = join(tmpDir, "envpkt.toml")
    writeFileSync(path, toml)

    const result = loadConfig(path)
    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.meta["DB_PASS"]?.service).toBe("postgres")
        expect(config.meta["DB_PASS"]?.created).toBe("2025-01-01")
      },
    )
  })

  it("returns Left for invalid TOML content", () => {
    const path = join(tmpDir, "bad.toml")
    writeFileSync(path, "not valid [[[ toml")

    const result = loadConfig(path)
    result.fold(
      (err) => expect(err._tag).toBe("ParseError"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left for valid TOML but invalid schema", () => {
    const path = join(tmpDir, "invalid-schema.toml")
    writeFileSync(path, 'name = "not an envpkt config"\n')

    const result = loadConfig(path)
    result.fold(
      (err) => expect(err._tag).toBe("ValidationError"),
      () => expect.unreachable("Expected Left"),
    )
  })
})
