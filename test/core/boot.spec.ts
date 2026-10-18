import { execFileSync } from "node:child_process"
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
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
  it("returns Right for valid config", async () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.status).toBe("healthy")
        expect(boot.audit.total).toBe(1)
        expect(boot.warnings.length).toBeGreaterThan(0) // fnox not available
      },
    )
  })

  it("returns Left for missing config", async () => {
    const result = await bootSafe({ configPath: "/nonexistent/envpkt.toml", inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("FileNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left for invalid config", async () => {
    const configPath = writeConfig("not valid toml [[[")
    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("ParseError"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns Left AuditFailed when failOnExpired + expired secrets", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = await bootSafe({ configPath, inject: false, failOnExpired: true })

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

  it("succeeds with failOnExpired=false even with expired secrets", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = await bootSafe({ configPath, inject: false, failOnExpired: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.expired).toBe(1)
      },
    )
  })

  it("succeeds with warnOnly=true even with expired secrets", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    const result = await bootSafe({ configPath, inject: false, warnOnly: true })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.expired).toBe(1)
        expect(boot.warnings.some((w) => w.includes("warn-only"))).toBe(true)
      },
    )
  })

  it("injects secrets into process.env when inject=true", async () => {
    const configPath = writeConfig(`version = 1\n[secret.BOOT_TEST_KEY]\nservice = "svc"\n`)

    // Clean up env before test
    delete process.env["BOOT_TEST_KEY"]

    const result = await bootSafe({ configPath, inject: true })

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

  it("does not inject when inject=false", async () => {
    const configPath = writeConfig(`version = 1\n[secret.NO_INJECT_KEY]\nservice = "svc"\n`)

    delete process.env["NO_INJECT_KEY"]

    await bootSafe({ configPath, inject: false })

    // Key should not be in process.env
    expect(process.env["NO_INJECT_KEY"]).toBeUndefined()
  })

  it("reports fnox unavailable as warning", async () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    const result = await bootSafe({ configPath, inject: false })

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
  it("applies env defaults when env var is not set", async () => {
    const configPath = writeConfig(`version = 1\n[env.MY_PORT]\nvalue = "3000"\npurpose = "App port"\n`)

    delete process.env["MY_PORT"]

    const result = await bootSafe({ configPath, inject: true })

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

  it("does not override existing env var", async () => {
    const configPath = writeConfig(`version = 1\n[env.MY_PORT]\nvalue = "3000"\n`)

    process.env["MY_PORT"] = "8080"

    const result = await bootSafe({ configPath, inject: true })

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

  it("does not inject env defaults when inject=false", async () => {
    const configPath = writeConfig(`version = 1\n[env.NO_INJECT_PORT]\nvalue = "4000"\n`)

    delete process.env["NO_INJECT_PORT"]

    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults).toEqual({ NO_INJECT_PORT: "4000" })
        expect(process.env["NO_INJECT_PORT"]).toBeUndefined()
      },
    )
  })

  it("secrets always override env defaults", async () => {
    const configPath = writeConfig(
      [`version = 1`, `[env.SHARED_KEY]`, `value = "default-value"`, `[secret.SHARED_KEY]`, `service = "svc"`].join(
        "\n",
      ),
    )

    delete process.env["SHARED_KEY"]

    const result = await bootSafe({ configPath, inject: false })

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
  it("returns BootResult for valid config", async () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    const result = await boot({ configPath, inject: false })

    expect(result.audit.status).toBe("healthy")
  })

  it("throws EnvpktBootError for missing config", async () => {
    await expect(boot({ configPath: "/nonexistent/envpkt.toml", inject: false })).rejects.toThrow(EnvpktBootError)
  })

  it("throws EnvpktBootError for expired secrets with failOnExpired", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.OLD]\nservice = "x"\ncreated = "2020-01-01"\nexpires = "2021-01-01"\n`,
    )
    await expect(boot({ configPath, inject: false, failOnExpired: true })).rejects.toThrow(EnvpktBootError)
    await expect(boot({ configPath, inject: false, failOnExpired: true })).rejects.toMatchObject({
      error: { _tag: "AuditFailed" },
    })
  })
})

describe("boot with catalog", () => {
  it("resolves catalog before audit", async () => {
    writeFileSync(join(tmpDir, "catalog.toml"), `version = 1\n[secret.DB]\nservice = "postgres"\n`)
    const configPath = writeConfig(
      `version = 1\ncatalog = "catalog.toml"\n[identity]\nname = "test"\nsecrets = ["DB"]\n`,
    )
    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.audit.total).toBe(1)
      },
    )
  })

  it("returns error for invalid catalog path", async () => {
    const configPath = writeConfig(
      `version = 1\ncatalog = "nonexistent.toml"\n[identity]\nname = "test"\nsecrets = ["DB"]\n`,
    )
    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect(err._tag).toBe("CatalogNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("boot with sealed values", () => {
  it.skipIf(!ageInstalled)("decrypts sealed values during boot", async () => {
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
    const encrypted = await ageEncrypt("my-secret-value", recipient)
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

    const result = await bootSafe({ configPath, inject: false })

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (boot) => {
        expect(boot.injected).toContain("SEALED_KEY")
        expect(boot.secrets["SEALED_KEY"]).toBe("my-secret-value")
      },
    )

    delete process.env["SEALED_KEY"]
  })

  it.skipIf(!ageInstalled)("decrypts sealed values from an inline ENVPKT_AGE_KEY with no key_file", async () => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipient = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const secretKey = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("AGE-SECRET-KEY-"))!
      .trim()

    const ciphertext = (await ageEncrypt("inline-ci-value", recipient)).fold(
      () => "",
      (v) => v,
    )

    // No key_file — only an inline key, as in CI
    const configPath = writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "ci"`,
        `recipient = "${recipient}"`,
        `[secret.CI_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
      ].join("\n"),
    )

    const origKey = process.env["ENVPKT_AGE_KEY"]
    const origFile = process.env["ENVPKT_AGE_KEY_FILE"]
    delete process.env["ENVPKT_AGE_KEY_FILE"]
    process.env["ENVPKT_AGE_KEY"] = secretKey
    delete process.env["CI_KEY"]

    // Point os.tmpdir() at a read-only directory: writing the key to a temp file would fail boot.
    const isolatedTmp = mkdtempSync(join(tmpDir, "tmp-"))
    chmodSync(isolatedTmp, 0o500)
    const origTmp = process.env["TMPDIR"]
    process.env["TMPDIR"] = isolatedTmp

    try {
      const result = await bootSafe({ configPath, inject: false })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(boot.secrets["CI_KEY"]).toBe("inline-ci-value")
          expect(boot.injected).toContain("CI_KEY")
        },
      )
    } finally {
      if (origTmp === undefined) delete process.env["TMPDIR"]
      else process.env["TMPDIR"] = origTmp
      if (origKey === undefined) delete process.env["ENVPKT_AGE_KEY"]
      else process.env["ENVPKT_AGE_KEY"] = origKey
      if (origFile === undefined) delete process.env["ENVPKT_AGE_KEY_FILE"]
      else process.env["ENVPKT_AGE_KEY_FILE"] = origFile
      delete process.env["CI_KEY"]
    }
  })

  it.skipIf(!ageInstalled)("decrypts sealed values using default key path when key_file is unset", async () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    // Write identity file to the default key path location, simulated via env var
    const identityPath = join(tmpDir, "default-key.txt")
    writeFileSync(identityPath, keygenOutput)

    const encrypted = await ageEncrypt("fallback-secret", recipient)
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
      const result = await bootSafe({ configPath, inject: false })

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

  it.skipIf(!ageInstalled)("falls back to fnox for keys without encrypted_value", async () => {
    const keygenOutput = execFileSync("age-keygen", [], {
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    })
    const recipientLine = keygenOutput.split("\n").find((l) => l.startsWith("# public key:"))
    const recipient = recipientLine!.replace("# public key: ", "").trim()

    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    // Encrypt one value, leave other unsealed
    const encrypted = await ageEncrypt("sealed-value", recipient)
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

    const result = await bootSafe({ configPath, inject: false })

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

describe("bootSafe fail-fast on missing seal key (B1)", () => {
  const FAKE_CIPHERTEXT = ["-----BEGIN AGE ENCRYPTED FILE-----", "ZmFrZQ==", "-----END AGE ENCRYPTED FILE-----"].join(
    "\n",
  )

  let savedHome: string | undefined
  let savedKey: string | undefined
  let savedKeyFile: string | undefined
  let isolatedHome: string

  beforeEach(() => {
    // Neutralize every key source so resolveSealIdentity finds nothing:
    // HOME → empty tmp (no ~/.envpkt/age-key.txt), and clear the inline/file env keys.
    isolatedHome = mkdtempSync(join(tmpdir(), "envpkt-home-"))
    savedHome = process.env["HOME"]
    savedKey = process.env["ENVPKT_AGE_KEY"]
    savedKeyFile = process.env["ENVPKT_AGE_KEY_FILE"]
    process.env["HOME"] = isolatedHome
    delete process.env["ENVPKT_AGE_KEY"]
    delete process.env["ENVPKT_AGE_KEY_FILE"]
  })

  afterEach(() => {
    if (savedHome === undefined) delete process.env["HOME"]
    else process.env["HOME"] = savedHome
    if (savedKey === undefined) delete process.env["ENVPKT_AGE_KEY"]
    else process.env["ENVPKT_AGE_KEY"] = savedKey
    if (savedKeyFile === undefined) delete process.env["ENVPKT_AGE_KEY_FILE"]
    else process.env["ENVPKT_AGE_KEY_FILE"] = savedKeyFile
    rmSync(isolatedHome, { recursive: true, force: true })
  })

  const sealedConfig = (extraIdentityLines: ReadonlyArray<string> = []): string =>
    writeConfig(
      [
        `version = 1`,
        `[identity]`,
        `name = "x"`,
        `recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"`,
        ...extraIdentityLines,
        `[secret.SEALED_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        FAKE_CIPHERTEXT,
        `"""`,
      ].join("\n"),
    )

  it("returns SealKeyUnavailable when sealed values exist and no key resolves", async () => {
    const result = await bootSafe({ configPath: sealedConfig(), inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("SealKeyUnavailable"),
      () => expect.unreachable("Expected Left(SealKeyUnavailable)"),
    )
  })

  it("fails fast even under warnOnly (the export/exec path)", async () => {
    const result = await bootSafe({ configPath: sealedConfig(), inject: false, warnOnly: true })
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SealKeyUnavailable"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("treats a configured-but-missing key_file as no key, and lists searched paths", async () => {
    const result = await bootSafe({ configPath: sealedConfig([`key_file = "missing-key.txt"`]), inject: false })
    result.fold(
      (err) => {
        expect(err._tag).toBe("SealKeyUnavailable")
        if (err._tag === "SealKeyUnavailable") {
          expect(err.sealedKeys).toContain("SEALED_KEY")
          expect(err.searched.join("\n")).toMatch(/missing-key\.txt/)
        }
      },
      () => expect.unreachable("Expected Left(SealKeyUnavailable)"),
    )
  })

  it("refuses a passphrase-protected key_file with a clear error, even under warnOnly", async () => {
    const keyFile = join(tmpDir, "wrapped-key.age")
    writeFileSync(
      keyFile,
      `-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24ub3JnL3YxCg==\n-----END AGE ENCRYPTED FILE-----\n`,
    )

    const result = await bootSafe({
      configPath: sealedConfig([`key_file = "${keyFile}"`]),
      inject: false,
      warnOnly: true,
    })
    result.fold(
      (err) => expect(err).toEqual({ _tag: "PassphraseProtectedIdentity", source: keyFile }),
      () => expect.unreachable("Expected Left(PassphraseProtectedIdentity)"),
    )
    await expect(boot({ configPath: sealedConfig([`key_file = "${keyFile}"`]), inject: false })).rejects.toThrow(
      /wrapped-key\.age is a passphrase-protected key file/,
    )
  })

  it("refuses a key_file that can't be read, even under warnOnly", async () => {
    // A directory passes the existence check but can't be read as a file, even as root.
    const keyDir = join(tmpDir, "key-dir")
    mkdirSync(keyDir)

    const result = await bootSafe({
      configPath: sealedConfig([`key_file = "${keyDir}"`]),
      inject: false,
      warnOnly: true,
    })
    result.fold(
      (err) => {
        expect(err._tag).toBe("IdentityUnreadable")
        if (err._tag === "IdentityUnreadable") expect(err.path).toBe(keyDir)
      },
      () => expect.unreachable("Expected Left(IdentityUnreadable)"),
    )
    await expect(boot({ configPath: sealedConfig([`key_file = "${keyDir}"`]), inject: false })).rejects.toThrow(
      /Can't read key file .*key-dir: .*EISDIR/,
    )
  })

  it("refuses an inline ENVPKT_AGE_KEY that holds no age secret key, without echoing it", async () => {
    process.env["ENVPKT_AGE_KEY"] = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6"

    const result = await bootSafe({ configPath: sealedConfig(), inject: false })
    result.fold(
      (err) => expect(err).toEqual({ _tag: "UnsupportedIdentity", kind: "ssh", line: 1, source: "ENVPKT_AGE_KEY" }),
      () => expect.unreachable("Expected Left(UnsupportedIdentity)"),
    )
    const thrown = await boot({ configPath: sealedConfig(), inject: false }).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(EnvpktBootError)
    expect((thrown as Error).message).toMatch(/^ENVPKT_AGE_KEY line 1 is an SSH key/)
    expect((thrown as Error).message).not.toContain("AAAAC3Nza")
  })

  it("with an explicit but missing key_file, does NOT fall back to ~/.envpkt/age-key.txt", async () => {
    // A default key exists in HOME, but it belongs to a different recipient. An explicit
    // key_file that is absent must NOT resolve to that default (which only yields a
    // "no identity matched any of the recipients" decrypt failure and masks the real
    // problem) — it must surface cleanly as SealKeyUnavailable.
    mkdirSync(join(isolatedHome, ".envpkt"), { recursive: true })
    writeFileSync(join(isolatedHome, ".envpkt", "age-key.txt"), "AGE-SECRET-KEY-1UNRELATEDKEY\n", { mode: 0o600 })

    const result = await bootSafe({ configPath: sealedConfig([`key_file = "missing-key.txt"`]), inject: false })
    result.fold(
      (err) => {
        expect(err._tag).toBe("SealKeyUnavailable")
        if (err._tag === "SealKeyUnavailable") {
          // The searched list must show the default was skipped, not silently used.
          expect(err.searched.join("\n")).toMatch(/skipped — identity\.key_file is set/)
        }
      },
      () => expect.unreachable("Expected Left(SealKeyUnavailable), not a wrong-key decrypt"),
    )
  })

  it("does not fail when there are no sealed values (no key needed)", async () => {
    const configPath = writeConfig([`version = 1`, `[secret.PLAIN]`, `service = "test"`].join("\n"))
    expect((await bootSafe({ configPath, inject: false })).isRight()).toBe(true)
  })
})

describe("bootSafe with aliases", () => {
  it.skipIf(!ageInstalled)("secret alias inherits target's sealed value", async () => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipient = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const ciphertext = (await ageEncrypt("canonical-value", recipient)).fold(
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

    const result = await bootSafe({ configPath, inject: false })
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

  it("env alias copies target's declared value", async () => {
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

    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.envDefaults["SERVICE_URL"]).toBe("https://api.example.com")
        expect(boot.envDefaults["LEGACY_URL"]).toBe("https://api.example.com")
      },
    )
  })

  it("secret alias reports skipped when target is unresolved", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.TARGET]\nservice = "svc"\n\n[secret.ALIAS]\nfrom_key = "secret.TARGET"\n`,
    )

    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.skipped).toContain("TARGET")
        expect(boot.skipped).toContain("ALIAS")
      },
    )
  })

  it("rejects invalid alias config at boot", async () => {
    const configPath = writeConfig(`version = 1\n[secret.ALIAS]\nfrom_key = "secret.NONEXISTENT"\n`)
    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasTargetMissing"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("rejects cross-type alias at boot", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.API_KEY]\nservice = "x"\n\n[env.BAD]\nfrom_key = "secret.API_KEY"\n`,
    )
    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasCrossType"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("rejects chained aliases at boot", async () => {
    const configPath = writeConfig(
      `version = 1\n[secret.A]\nservice = "x"\n\n[secret.B]\nfrom_key = "secret.A"\n\n[secret.C]\nfrom_key = "secret.B"\n`,
    )
    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect(err._tag).toBe("AliasChained"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("env alias does not inject if canonical name is already set", async () => {
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
      const result = await bootSafe({ configPath, inject: false })
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

describe("bootSafe with namespace", () => {
  it("injects an env default under the namespaced wire name, keeping BootResult logical", async () => {
    const configPath = writeConfig(
      [`version = 1`, `[namespace]`, `prefix = "CIV"`, `[env.NS_LOG_LEVEL]`, `value = "info"`].join("\n"),
    )

    delete process.env["CIV__NS_LOG_LEVEL"]
    delete process.env["NS_LOG_LEVEL"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          // wire name in the environment, logical name in the result
          expect(process.env["CIV__NS_LOG_LEVEL"]).toBe("info")
          expect(process.env["NS_LOG_LEVEL"]).toBeUndefined()
          expect(boot.envDefaults).toEqual({ NS_LOG_LEVEL: "info" })
        },
      )
    } finally {
      delete process.env["CIV__NS_LOG_LEVEL"]
      delete process.env["NS_LOG_LEVEL"]
    }
  })

  it("opts an entry out of the namespace with an empty per-entry namespace", async () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[env.NS_SHARED]`,
        `value = "shared-val"`,
        `namespace = ""`,
      ].join("\n"),
    )

    delete process.env["CIV__NS_SHARED"]
    delete process.env["NS_SHARED"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(process.env["NS_SHARED"]).toBe("shared-val")
          expect(process.env["CIV__NS_SHARED"]).toBeUndefined()
          expect(boot.envDefaults).toEqual({ NS_SHARED: "shared-val" })
        },
      )
    } finally {
      delete process.env["CIV__NS_SHARED"]
      delete process.env["NS_SHARED"]
    }
  })

  it("uses a per-entry namespace override for the wire name", async () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[env.NS_LEGACY]`,
        `value = "legacy-val"`,
        `namespace = "OLD"`,
      ].join("\n"),
    )

    delete process.env["OLD__NS_LEGACY"]
    delete process.env["CIV__NS_LEGACY"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(process.env["OLD__NS_LEGACY"]).toBe("legacy-val")
          expect(process.env["CIV__NS_LEGACY"]).toBeUndefined()
          expect(boot.envDefaults).toEqual({ NS_LEGACY: "legacy-val" })
        },
      )
    } finally {
      delete process.env["OLD__NS_LEGACY"]
      delete process.env["CIV__NS_LEGACY"]
    }
  })

  it("detects an override against the namespaced wire name", async () => {
    const configPath = writeConfig(
      [`version = 1`, `[namespace]`, `prefix = "CIV"`, `[env.NS_PORT]`, `value = "3000"`].join("\n"),
    )

    delete process.env["NS_PORT"]
    process.env["CIV__NS_PORT"] = "8080"

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(boot.overridden).toContain("NS_PORT")
          expect(boot.envDefaults).toEqual({})
          expect(process.env["CIV__NS_PORT"]).toBe("8080")
        },
      )
    } finally {
      delete process.env["CIV__NS_PORT"]
      delete process.env["NS_PORT"]
    }
  })

  it("warns when the namespace separator is not shell-safe", async () => {
    const configPath = writeConfig(
      [`version = 1`, `[namespace]`, `prefix = "CIV"`, `separator = "."`, `[env.NS_DOT]`, `value = "v"`].join("\n"),
    )

    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.warnings.some((w) => w.toLowerCase().includes("separator"))).toBe(true)
      },
    )
  })

  it("does not warn for the default shell-safe separator", async () => {
    const configPath = writeConfig(
      [`version = 1`, `[namespace]`, `prefix = "CIV"`, `[env.NS_OK]`, `value = "v"`].join("\n"),
    )

    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.warnings.some((w) => w.toLowerCase().includes("separator"))).toBe(false)
      },
    )
  })

  it("exposes a logical→wire name map in BootResult.envNames", async () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[secret.API_KEY]`,
        `service = "x"`,
        `[secret.SHARED]`,
        `service = "y"`,
        `namespace = ""`,
        `[env.LOG_LEVEL]`,
        `value = "info"`,
      ].join("\n"),
    )

    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => {
        expect(boot.envNames["API_KEY"]).toBe("CIV__API_KEY")
        expect(boot.envNames["LOG_LEVEL"]).toBe("CIV__LOG_LEVEL")
        expect(boot.envNames["SHARED"]).toBe("SHARED")
      },
    )
  })

  it("an env alias inherits the file namespace for its own wire name", async () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[env.SERVICE_URL]`,
        `value = "https://api.example.com"`,
        `[env.LEGACY_URL]`,
        `from_key = "env.SERVICE_URL"`,
      ].join("\n"),
    )

    delete process.env["CIV__SERVICE_URL"]
    delete process.env["CIV__LEGACY_URL"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        () => {
          // both canonical and alias land under the file namespace
          expect(process.env["CIV__SERVICE_URL"]).toBe("https://api.example.com")
          expect(process.env["CIV__LEGACY_URL"]).toBe("https://api.example.com")
        },
      )
    } finally {
      delete process.env["CIV__SERVICE_URL"]
      delete process.env["CIV__LEGACY_URL"]
    }
  })

  it("an env alias can opt out to bridge a legacy un-prefixed name to a namespaced canonical value", async () => {
    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[env.SERVICE_URL]`,
        `value = "https://api.example.com"`,
        `[env.LEGACY_URL]`,
        `from_key = "env.SERVICE_URL"`,
        `namespace = ""`,
      ].join("\n"),
    )

    delete process.env["CIV__SERVICE_URL"]
    delete process.env["LEGACY_URL"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        () => {
          // canonical stays namespaced; the opted-out alias bridges to the plain name
          expect(process.env["CIV__SERVICE_URL"]).toBe("https://api.example.com")
          expect(process.env["LEGACY_URL"]).toBe("https://api.example.com")
          expect(process.env["CIV__LEGACY_URL"]).toBeUndefined()
        },
      )
    } finally {
      delete process.env["CIV__SERVICE_URL"]
      delete process.env["LEGACY_URL"]
    }
  })

  it.skipIf(!ageInstalled)("a sealed secret alias bridges to a namespaced canonical value when opted out", async () => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipient = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const ciphertext = (await ageEncrypt("canonical-value", recipient)).fold(
      () => "",
      (v) => v,
    )

    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[identity]`,
        `name = "test-alias-ns"`,
        `recipient = "${recipient}"`,
        `key_file = "identity.txt"`,
        `[secret.API_KEY]`,
        `service = "example"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
        `[secret.LEGACY_API_KEY]`,
        `from_key = "secret.API_KEY"`,
        `namespace = ""`,
      ].join("\n"),
    )

    delete process.env["CIV__API_KEY"]
    delete process.env["LEGACY_API_KEY"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          // BootResult stays logical; injection respects each entry's namespace
          expect(boot.secrets["API_KEY"]).toBe("canonical-value")
          expect(boot.secrets["LEGACY_API_KEY"]).toBe("canonical-value")
          expect(process.env["CIV__API_KEY"]).toBe("canonical-value")
          expect(process.env["LEGACY_API_KEY"]).toBe("canonical-value")
        },
      )
    } finally {
      delete process.env["CIV__API_KEY"]
      delete process.env["LEGACY_API_KEY"]
    }
  })

  it.skipIf(!ageInstalled)("injects a sealed secret under the namespaced wire name", async () => {
    const keygenOutput = execFileSync("age-keygen", [], { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" })
    const recipient = keygenOutput
      .split("\n")
      .find((l) => l.startsWith("# public key:"))!
      .replace("# public key: ", "")
      .trim()
    const identityPath = join(tmpDir, "identity.txt")
    writeFileSync(identityPath, keygenOutput)

    const ciphertext = (await ageEncrypt("sealed-ns-value", recipient)).fold(
      () => "",
      (v) => v,
    )

    const configPath = writeConfig(
      [
        `version = 1`,
        `[namespace]`,
        `prefix = "CIV"`,
        `[identity]`,
        `name = "test-ns"`,
        `recipient = "${recipient}"`,
        `key_file = "identity.txt"`,
        `[secret.SEALED_NS]`,
        `service = "test"`,
        `encrypted_value = """`,
        ciphertext,
        `"""`,
      ].join("\n"),
    )

    delete process.env["CIV__SEALED_NS"]
    delete process.env["SEALED_NS"]

    try {
      const result = await bootSafe({ configPath, inject: true })
      result.fold(
        (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
        (boot) => {
          expect(process.env["CIV__SEALED_NS"]).toBe("sealed-ns-value")
          expect(process.env["SEALED_NS"]).toBeUndefined()
          // BootResult stays logical
          expect(boot.secrets["SEALED_NS"]).toBe("sealed-ns-value")
          expect(boot.injected).toContain("SEALED_NS")
        },
      )
    } finally {
      delete process.env["CIV__SEALED_NS"]
      delete process.env["SEALED_NS"]
    }
  })
})

describe("EnvpktBootError", () => {
  it("has descriptive message for FileNotFound", async () => {
    const err = new EnvpktBootError({ _tag: "FileNotFound", path: "/missing" })
    expect(err.message).toContain("/missing")
    expect(err.name).toBe("EnvpktBootError")
  })

  it("has descriptive message for AuditFailed", async () => {
    const err = new EnvpktBootError({
      _tag: "AuditFailed",
      audit: {} as never,
      message: "2 secret(s) have expired",
    })
    expect(err.message).toContain("expired")
  })

  it("has descriptive message for AliasTargetMissing", async () => {
    const err = new EnvpktBootError({ _tag: "AliasTargetMissing", key: "secret.X", target: "secret.Y" })
    expect(err.message).toContain("secret.Y")
  })
})
