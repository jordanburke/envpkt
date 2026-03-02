import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { homedir } from "node:os"
import {
  expandPath,
  findConfigPath,
  readConfigFile,
  parseToml,
  loadConfig,
  validateConfig,
} from "../../src/core/config.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("expandPath", () => {
  it("expands ~ to home directory", () => {
    expect(expandPath("~/keys/identity.txt")).toBe(join(homedir(), "keys/identity.txt"))
  })

  it("expands bare ~", () => {
    expect(expandPath("~")).toBe(homedir())
  })

  it("does not expand ~ in the middle of a path", () => {
    expect(expandPath("/some/~file")).toBe("/some/~file")
  })

  it("expands $VAR syntax", () => {
    process.env["ENVPKT_TEST_DIR"] = "/tmp/secrets"
    expect(expandPath("$ENVPKT_TEST_DIR/identity.txt")).toBe("/tmp/secrets/identity.txt")
    delete process.env["ENVPKT_TEST_DIR"]
  })

  it("expands ${VAR} syntax", () => {
    process.env["ENVPKT_TEST_DIR"] = "/tmp/secrets"
    expect(expandPath("${ENVPKT_TEST_DIR}/identity.txt")).toBe("/tmp/secrets/identity.txt")
    delete process.env["ENVPKT_TEST_DIR"]
  })

  it("replaces undefined env vars with empty string", () => {
    delete process.env["ENVPKT_NONEXISTENT"]
    expect(expandPath("$ENVPKT_NONEXISTENT/file")).toBe("/file")
  })

  it("passes through plain relative paths unchanged", () => {
    expect(expandPath("sealed-identity.txt")).toBe("sealed-identity.txt")
  })

  it("passes through absolute paths unchanged", () => {
    expect(expandPath("/etc/keys/identity.txt")).toBe("/etc/keys/identity.txt")
  })
})

describe("findConfigPath", () => {
  it("returns Some when envpkt.toml exists", () => {
    writeFileSync(join(tmpDir, "envpkt.toml"), "version = 1\n[secret]\n")
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
    const content = 'version = 1\n[secret.KEY]\nservice = "test"\n'
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
    const result = parseToml('version = 1\n[secret.KEY]\nservice = "test"\n')
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
    const result = parseToml('version = 1\n[secret.KEY]\nservice = "test"\ncreated = 2025-01-15\n')
    result.fold(
      () => expect.unreachable("Expected Right"),
      (data) => {
        const obj = data as { secret: { KEY: { created: string } } }
        expect(obj.secret.KEY.created).toBe("2025-01-15")
      },
    )
  })
})

describe("validateConfig", () => {
  it("returns Right for valid config", () => {
    const data = { version: 1, secret: { API_KEY: { service: "test" } } }
    const result = validateConfig(data)
    result.fold(
      () => expect.unreachable("Expected Right"),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.secret["API_KEY"]?.service).toBe("test")
      },
    )
  })

  it("returns Right for config with empty secret entry (service optional)", () => {
    const data = { version: 1, secret: { API_KEY: {} } }
    const result = validateConfig(data)
    result.fold(
      () => expect.unreachable("Expected Right"),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.secret["API_KEY"]).toBeDefined()
      },
    )
  })

  it("returns Left ValidationError for missing required fields", () => {
    const data = {}
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
    const toml = `version = 1\n\n[secret.DB_PASS]\nservice = "postgres"\ncreated = 2025-01-01\n`
    const path = join(tmpDir, "envpkt.toml")
    writeFileSync(path, toml)

    const result = loadConfig(path)
    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.secret["DB_PASS"]?.service).toBe("postgres")
        expect(config.secret["DB_PASS"]?.created).toBe("2025-01-01")
      },
    )
  })

  it("loads config with optional service", () => {
    const toml = `version = 1\n\n[secret.KEY]\npurpose = "testing"\n`
    const path = join(tmpDir, "envpkt.toml")
    writeFileSync(path, toml)

    const result = loadConfig(path)
    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (config) => {
        expect(config.secret["KEY"]?.purpose).toBe("testing")
        expect(config.secret["KEY"]?.service).toBeUndefined()
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
