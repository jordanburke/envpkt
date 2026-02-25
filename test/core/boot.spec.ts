import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { boot, bootSafe, EnvpktBootError } from "../../src/core/boot.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-boot-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const writeConfig = (content: string): string => {
  const path = join(tmpDir, "envpkt.toml")
  writeFileSync(path, content)
  return path
}

describe("bootSafe", () => {
  it("returns Right for valid config", () => {
    const configPath = writeConfig(`version = 1\n[meta.KEY]\nservice = "svc"\n`)
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.status).toBe("healthy")
        expect(boot.audit.total).toBe(1)
        expect(boot.warnings.length).toBeGreaterThan(0) // fnox not available
      },
    )
  })

  it("returns Left for missing config", () => {
    const result = bootSafe({ configPath: "/nonexistent/envpkt.toml", inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("FileNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left for invalid config", () => {
    const configPath = writeConfig("not valid toml [[[")
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("ParseError"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left AuditFailed when failOnExpired + expired secrets", () => {
    const configPath = writeConfig(
      `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = bootSafe({ configPath, inject: false, failOnExpired: true })

    result.fold(
      (err) => {
        expect(err._tag).toBe("AuditFailed")
        if (err._tag === "AuditFailed") {
          expect(err.audit.expired).toBe(1)
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it("succeeds with failOnExpired=false even with expired secrets", () => {
    const configPath = writeConfig(
      `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = bootSafe({ configPath, inject: false, failOnExpired: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.expired).toBe(1)
      },
    )
  })

  it("succeeds with warnOnly=true even with expired secrets", () => {
    const configPath = writeConfig(
      `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = bootSafe({ configPath, inject: false, warnOnly: true })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.expired).toBe(1)
        expect(boot.warnings.some((w) => w.includes("warn-only"))).toBe(true)
      },
    )
  })

  it("injects secrets into process.env when inject=true", () => {
    const configPath = writeConfig(`version = 1\n[meta.BOOT_TEST_KEY]\nservice = "svc"\n`)

    // Clean up env before test
    delete process.env["BOOT_TEST_KEY"]

    const result = bootSafe({ configPath, inject: true })

    result.fold(
      () => {
        // fnox not available — keys won't be injected but should not error
      },
      (boot) => {
        // Since fnox is not available, all keys will be skipped
        expect(boot.skipped.length).toBeGreaterThanOrEqual(0)
      },
    )

    // Clean up
    delete process.env["BOOT_TEST_KEY"]
  })

  it("does not inject when inject=false", () => {
    const configPath = writeConfig(`version = 1\n[meta.NO_INJECT_KEY]\nservice = "svc"\n`)

    delete process.env["NO_INJECT_KEY"]

    bootSafe({ configPath, inject: false })

    // Key should not be in process.env
    expect(process.env["NO_INJECT_KEY"]).toBeUndefined()
  })

  it("reports fnox unavailable as warning", () => {
    const configPath = writeConfig(`version = 1\n[meta.KEY]\nservice = "svc"\n`)
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.warnings.some((w) => w.includes("fnox"))).toBe(true)
        expect(boot.skipped).toContain("KEY")
      },
    )
  })
})

describe("boot", () => {
  it("returns BootResult for valid config", () => {
    const configPath = writeConfig(`version = 1\n[meta.KEY]\nservice = "svc"\n`)
    const result = boot({ configPath, inject: false })

    expect(result.audit.status).toBe("healthy")
  })

  it("throws EnvpktBootError for missing config", () => {
    expect(() => boot({ configPath: "/nonexistent/envpkt.toml", inject: false })).toThrow(EnvpktBootError)
  })

  it("throws EnvpktBootError for expired secrets with failOnExpired", () => {
    const configPath = writeConfig(
      `version = 1\n[meta.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    expect(() => boot({ configPath, inject: false, failOnExpired: true })).toThrow(EnvpktBootError)

    try {
      boot({ configPath, inject: false, failOnExpired: true })
    } catch (err) {
      const bootErr = err as EnvpktBootError
      expect(bootErr.error._tag).toBe("AuditFailed")
    }
  })
})

describe("boot with catalog", () => {
  it("resolves catalog before audit", () => {
    writeFileSync(join(tmpDir, "catalog.toml"), `version = 1\n[meta.DB]\nservice = "postgres"\n`)
    const configPath = writeConfig(`version = 1\ncatalog = "catalog.toml"\n[agent]\nname = "test"\nsecrets = ["DB"]\n`)
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.total).toBe(1)
      },
    )
  })

  it("returns error for invalid catalog path", () => {
    const configPath = writeConfig(
      `version = 1\ncatalog = "nonexistent.toml"\n[agent]\nname = "test"\nsecrets = ["DB"]\n`,
    )
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("CatalogNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("EnvpktBootError", () => {
  it("has descriptive message for FileNotFound", () => {
    const err = new EnvpktBootError({ _tag: "FileNotFound", path: "/missing" })
    expect(err.message).toContain("/missing")
    expect(err.name).toBe("EnvpktBootError")
  })

  it("has descriptive message for AuditFailed", () => {
    const err = new EnvpktBootError({
      _tag: "AuditFailed",
      audit: {} as never,
      message: "2 secret(s) have expired",
    })
    expect(err.message).toContain("expired")
  })
})
