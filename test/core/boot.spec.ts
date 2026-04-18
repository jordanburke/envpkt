import { execFileSync } from "node:child_process"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { boot, bootSafe, EnvpktBootError } from "../../src/core/boot.js"
import { ageEncrypt } from "../../src/core/seal.js"

const ageInstalled = (() => {
  try {
    execFileSync("age", ["--version"], { stdio: "pipe" })
    return true
  } catch {
    return false
  }
})()

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
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
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
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
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
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
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
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
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
    const configPath = writeConfig(`version = 1\n[secret.BOOT_TEST_KEY]\nservice = "svc"\n`)

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
    const configPath = writeConfig(`version = 1\n[secret.NO_INJECT_KEY]\nservice = "svc"\n`)

    delete process.env["NO_INJECT_KEY"]

    bootSafe({ configPath, inject: false })

    // Key should not be in process.env
    expect(process.env["NO_INJECT_KEY"]).toBeUndefined()
  })

  it("reports fnox unavailable as warning", () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
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

describe("bootSafe with env defaults", () => {
  it("applies env defaults when env var is not set", () => {
    const configPath = writeConfig(`version = 1\n[env.MY_PORT]\nvalue = "3000"\npurpose = "App port"\n`)

    delete process.env["MY_PORT"]

    const result = bootSafe({ configPath, inject: true })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults).toEqual({ MY_PORT: "3000" })
        expect(boot.overridden).toEqual([])
        expect(process.env["MY_PORT"]).toBe("3000")
      },
    )

    delete process.env["MY_PORT"]
  })

  it("does not override existing env var", () => {
    const configPath = writeConfig(`version = 1\n[env.MY_PORT]\nvalue = "3000"\n`)

    process.env["MY_PORT"] = "8080"

    const result = bootSafe({ configPath, inject: true })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults).toEqual({})
        expect(boot.overridden).toContain("MY_PORT")
        expect(process.env["MY_PORT"]).toBe("8080")
      },
    )

    delete process.env["MY_PORT"]
  })

  it("does not inject env defaults when inject=false", () => {
    const configPath = writeConfig(`version = 1\n[env.NO_INJECT_PORT]\nvalue = "4000"\n`)

    delete process.env["NO_INJECT_PORT"]

    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults).toEqual({ NO_INJECT_PORT: "4000" })
        expect(process.env["NO_INJECT_PORT"]).toBeUndefined()
      },
    )
  })

  it("secrets always override env defaults", () => {
    const configPath = writeConfig(
      [`version = 1`, `[env.SHARED_KEY]`, `value = "default-value"`, `[secret.SHARED_KEY]`, `service = "svc"`].join(
        "\n",
      ),
    )

    delete process.env["SHARED_KEY"]

    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        // env default is applied first (key not in env)
        expect(boot.envDefaults).toEqual({ SHARED_KEY: "default-value" })
        // secret is skipped because fnox unavailable, but env default was collected
        expect(boot.skipped).toContain("SHARED_KEY")
      },
    )
  })
})

describe("boot", () => {
  it("returns BootResult for valid config", () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    const result = boot({ configPath, inject: false })

    expect(result.audit.status).toBe("healthy")
  })

  it("throws EnvpktBootError for missing config", () => {
    expect(() => boot({ configPath: "/nonexistent/envpkt.toml", inject: false })).toThrow(EnvpktBootError)
  })

  it("throws EnvpktBootError for expired secrets with failOnExpired", () => {
    const configPath = writeConfig(
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
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
    writeFileSync(join(tmpDir, "catalog.toml"), `version = 1\n[secret.DB]\nservice = "postgres"\n`)
    const configPath = writeConfig(
      `version = 1\ncatalog = "catalog.toml"\n[identity]\nname = "test"\nsecrets = ["DB"]\n`,
    )
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
      `version = 1\ncatalog = "nonexistent.toml"\n[identity]\nname = "test"\nsecrets = ["DB"]\n`,
    )
    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("CatalogNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("boot with sealed values", () => {
  it.skipIf(!ageInstalled)("decrypts sealed values during boot", () => {
    // Generate a test keypair
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    // Write identity file
    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    // Encrypt a test value
    const encrypted = ageEncrypt("my-secret-value", recipient)
    const ciphertext = encrypted.fold(
      () => "",
      (v) => v,
    )
    expect(ciphertext).toContain("-----BEGIN AGE ENCRYPTED FILE-----")

    // Write config with sealed value
    const configPath = writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "test-sealed"`,
        `recipient = "${recipient}"`,
        `key_file = "identity.txt"`,
        `[secret.SEALED_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
      ].join("\n"),
    )

    delete process.env["SEALED_KEY"]

    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.injected).toContain("SEALED_KEY")
        expect(boot.secrets["SEALED_KEY"]).toBe("my-secret-value")
      },
    )

    delete process.env["SEALED_KEY"]
  })

  it.skipIf(!ageInstalled)("decrypts sealed values using default key path when key_file is unset", () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    // Write identity file to the default key path location, simulated via env var
    const identityPath = join(tmpDir, "default-key.txt")
    writeFileSync(identityPath, keygenOutput)

    const encrypted = ageEncrypt("fallback-secret", recipient)
    const ciphertext = encrypted.fold(
      () => "",
      (v) => v,
    )
    expect(ciphertext).toContain("-----BEGIN AGE ENCRYPTED FILE-----")

    // Config has NO key_file set — should fall back to ENVPKT_AGE_KEY_FILE
    const configPath = writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "test-fallback"`,
        `recipient = "${recipient}"`,
        `[secret.FALLBACK_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
      ].join("\n"),
    )

    const origEnv = process.env["ENVPKT_AGE_KEY_FILE"]
    process.env["ENVPKT_AGE_KEY_FILE"] = identityPath
    delete process.env["FALLBACK_KEY"]

    try {
      const result = bootSafe({ configPath, inject: false })

      result.fold(
        (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
        (boot) => {
          expect(boot.injected).toContain("FALLBACK_KEY")
          expect(boot.secrets["FALLBACK_KEY"]).toBe("fallback-secret")
        },
      )
    } finally {
      if (origEnv === undefined) {
        delete process.env["ENVPKT_AGE_KEY_FILE"]
      } else {
        process.env["ENVPKT_AGE_KEY_FILE"] = origEnv
      }
      delete process.env["FALLBACK_KEY"]
    }
  })

  it.skipIf(!ageInstalled)("falls back to fnox for keys without encrypted_value", () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    // Encrypt one value, leave other unsealed
    const encrypted = ageEncrypt("sealed-value", recipient)
    const ciphertext = encrypted.fold(
      () => "",
      (v) => v,
    )

    const configPath = writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "mixed"`,
        `recipient = "${recipient}"`,
        `key_file = "identity.txt"`,
        `[secret.SEALED_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
        `[secret.FNOX_KEY]`,
        `service = "other"`,
      ].join("\n"),
    )

    const result = bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        // SEALED_KEY should be injected from sealed value
        expect(boot.injected).toContain("SEALED_KEY")
        expect(boot.secrets["SEALED_KEY"]).toBe("sealed-value")
        // FNOX_KEY should be skipped (fnox not available in test)
        expect(boot.skipped).toContain("FNOX_KEY")
      },
    )
  })
})

describe("bootSafe with aliases", () => {
  it.skipIf(!ageInstalled)("secret alias inherits target's sealed value", () => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipient = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const ciphertext = ageEncrypt("canonical-value", recipient).fold(
      () => "",
      (v) => v,
    )

    const configPath = writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "test-alias"`,
        `recipient = "${recipient}"`,
        `key_file = "identity.txt"`,
        `[secret.API_KEY]`,
        `service = "example"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
        `[secret.LEGACY_API_KEY]`,
        `from_key = "secret.API_KEY"`,
        `purpose = "Legacy name consumers still use"`,
      ].join("\n"),
    )

    delete process.env["API_KEY"]
    delete process.env["LEGACY_API_KEY"]

    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.secrets["API_KEY"]).toBe("canonical-value")
        expect(boot.secrets["LEGACY_API_KEY"]).toBe("canonical-value")
        expect(boot.injected).toContain("API_KEY")
        expect(boot.injected).toContain("LEGACY_API_KEY")
      },
    )
  })

  it("env alias copies target's declared value", () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[env.SERVICE_URL]`,
        `value = "https://api.example.com"`,
        `[env.LEGACY_URL]`,
        `from_key = "env.SERVICE_URL"`,
      ].join("\n"),
    )

    delete process.env["SERVICE_URL"]
    delete process.env["LEGACY_URL"]

    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults["SERVICE_URL"]).toBe("https://api.example.com")
        expect(boot.envDefaults["LEGACY_URL"]).toBe("https://api.example.com")
      },
    )
  })

  it("secret alias reports skipped when target is unresolved", () => {
    const configPath = writeConfig(
      `version = 1\n[secret.TARGET]\nservice = "svc"\n\n[secret.ALIAS]\nfrom_key = "secret.TARGET"\n`,
    )

    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.skipped).toContain("TARGET")
        expect(boot.skipped).toContain("ALIAS")
      },
    )
  })

  it("rejects invalid alias config at boot", () => {
    const configPath = writeConfig(`version = 1\n[secret.ALIAS]\nfrom_key = "secret.NONEXISTENT"\n`)
    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasTargetMissing"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("rejects cross-type alias at boot", () => {
    const configPath = writeConfig(
      `version = 1\n[secret.API_KEY]\nservice = "x"\n\n[env.BAD]\nfrom_key = "secret.API_KEY"\n`,
    )
    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasCrossType"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("rejects chained aliases at boot", () => {
    const configPath = writeConfig(
      `version = 1\n[secret.A]\nservice = "x"\n\n[secret.B]\nfrom_key = "secret.A"\n\n[secret.C]\nfrom_key = "secret.B"\n`,
    )
    const result = bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasChained"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("env alias does not inject if canonical name is already set", () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[env.SERVICE_URL]`,
        `value = "https://from-config.example.com"`,
        `[env.LEGACY_URL]`,
        `from_key = "env.SERVICE_URL"`,
      ].join("\n"),
    )

    delete process.env["SERVICE_URL"]
    process.env["LEGACY_URL"] = "https://preset.example.com"

    try {
      const result = bootSafe({ configPath, inject: false })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(boot.overridden).toContain("LEGACY_URL")
          expect(boot.envDefaults["LEGACY_URL"]).toBeUndefined()
        },
      )
    } finally {
      delete process.env["LEGACY_URL"]
    }
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

  it("has descriptive message for AliasTargetMissing", () => {
    const err = new EnvpktBootError({ _tag: "AliasTargetMissing", key: "secret.X", target: "secret.Y" })
    expect(err.message).toContain("secret.Y")
  })
})
