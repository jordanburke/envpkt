import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { generateKeypair, resolveInlineKey, resolveKeyPath, updateConfigIdentity } from "../../src/core/keygen.js"

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
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-keygen-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("resolveKeyPath", () => {
  it("returns default path when env var is not set", () => {
    delete process.env["ENVPKT_AGE_KEY_FILE"]
    const path = resolveKeyPath()
    expect(path).toContain(".envpkt")
    expect(path).toContain("age-key.txt")
  })

  it("returns env var override when set", () => {
    vi.stubEnv("ENVPKT_AGE_KEY_FILE", "/custom/path/key.txt")
    const path = resolveKeyPath()
    expect(path).toBe("/custom/path/key.txt")
  })
})

describe("resolveInlineKey", () => {
  it("returns None when ENVPKT_AGE_KEY is not set", () => {
    vi.stubEnv("ENVPKT_AGE_KEY", "")
    const result = resolveInlineKey()
    expect(result.isNone()).toBe(true)
  })

  it("returns Some when ENVPKT_AGE_KEY is set", () => {
    vi.stubEnv("ENVPKT_AGE_KEY", "AGE-SECRET-KEY-1234")
    const result = resolveInlineKey()
    expect(result.isSome()).toBe(true)
    result.fold(
      () => expect.unreachable("Expected Some"),
      (v) => expect(v).toBe("AGE-SECRET-KEY-1234"),
    )
  })
})

describe("generateKeypair", () => {
  it.skipIf(!ageInstalled)("generates keypair to specified path", () => {
    const outputPath = join(tmpDir, "test-key.txt")
    const result = generateKeypair({ outputPath })

    result.fold(
      (err) => expect.unreachable(`Keygen failed: ${err._tag}`),
      (res) => {
        expect(res.recipient).toMatch(/^age1/)
        expect(res.identityPath).toBe(outputPath)
        expect(res.configUpdated).toBe(false)

        const content = readFileSync(outputPath, "utf-8")
        expect(content).toContain("AGE-SECRET-KEY-")
        expect(content).toContain("# public key: age1")
      },
    )
  })

  it.skipIf(!ageInstalled)("returns KeyExists when file exists and force=false", () => {
    const outputPath = join(tmpDir, "existing-key.txt")
    writeFileSync(outputPath, "existing content")

    const result = generateKeypair({ outputPath })

    result.fold(
      (err) => {
        expect(err._tag).toBe("KeyExists")
        if (err._tag === "KeyExists") {
          expect(err.path).toBe(outputPath)
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it.skipIf(!ageInstalled)("overwrites when force=true", () => {
    const outputPath = join(tmpDir, "overwrite-key.txt")
    writeFileSync(outputPath, "old content")

    const result = generateKeypair({ force: true, outputPath })

    result.fold(
      (err) => expect.unreachable(`Keygen failed: ${err._tag}`),
      (res) => {
        expect(res.recipient).toMatch(/^age1/)
        const content = readFileSync(outputPath, "utf-8")
        expect(content).toContain("AGE-SECRET-KEY-")
      },
    )
  })

  it.skipIf(!ageInstalled)("sets file permissions to 0o600", () => {
    const outputPath = join(tmpDir, "perms-key.txt")
    generateKeypair({ outputPath })

    const stats = statSync(outputPath)
    const mode = stats.mode & 0o777
    expect(mode).toBe(0o600)
  })

  it.skipIf(!ageInstalled)("creates parent directory if missing", () => {
    const outputPath = join(tmpDir, "nested", "dir", "key.txt")
    const result = generateKeypair({ outputPath })

    result.fold(
      (err) => expect.unreachable(`Keygen failed: ${err._tag}`),
      (res) => {
        expect(res.identityPath).toBe(outputPath)
        const content = readFileSync(outputPath, "utf-8")
        expect(content).toContain("AGE-SECRET-KEY-")
      },
    )
  })
})

describe("updateConfigIdentity", () => {
  it("adds recipient to existing [identity] section", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, `version = 1\n\n[identity]\nname = "test-agent"\n\n[secret.MY_KEY]\nservice = "test"\n`)

    const result = updateConfigIdentity(configPath, { recipient: "age1testrecipient123" })

    result.fold(
      (err) => expect.unreachable(`Update failed: ${err._tag}`),
      (v) => expect(v).toBe(true),
    )

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('recipient = "age1testrecipient123"')
    expect(content).toContain('name = "test-agent"')
    expect(content).toContain("[secret.MY_KEY]")
  })

  it("creates [identity] section with all fields when missing", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, `version = 1\n\n[secret.MY_KEY]\nservice = "test"\n`)

    updateConfigIdentity(configPath, {
      recipient: "age1newrecipient456",
      name: "my-agent",
      keyFile: "~/.envpkt/my-key.txt",
    })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[identity]")
    expect(content).toContain('recipient = "age1newrecipient456"')
    expect(content).toContain('name = "my-agent"')
    expect(content).toContain('key_file = "~/.envpkt/my-key.txt"')
  })

  it("updates existing recipient value", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(configPath, `version = 1\n\n[identity]\nname = "test"\nrecipient = "age1oldkey"\n`)

    updateConfigIdentity(configPath, { recipient: "age1newkey" })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain('recipient = "age1newkey"')
    expect(content).not.toContain("age1oldkey")
  })

  it("preserves TOML structure", () => {
    const configPath = join(tmpDir, "envpkt.toml")
    const original = `version = 1\n\n[identity]\nname = "test"\n\n[lifecycle]\nstale_warning_days = 90\n\n[secret.KEY]\nservice = "svc"\n`
    writeFileSync(configPath, original)

    updateConfigIdentity(configPath, { recipient: "age1recipient" })

    const content = readFileSync(configPath, "utf-8")
    expect(content).toContain("[lifecycle]")
    expect(content).toContain("stale_warning_days = 90")
    expect(content).toContain("[secret.KEY]")
    expect(content).toContain('service = "svc"')
  })
})
