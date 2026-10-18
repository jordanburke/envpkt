import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDirectTestLogger, type DirectLogger, directSilentLogger } from "functype-log"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { boot, bootSafe } from "../../src/core/boot.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-boot-logger-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const writeConfig = (content: string): string => {
  const path = join(tmpDir, "envpkt.toml")
  writeFileSync(path, content)
  return path
}

describe("bootSafe logger", () => {
  it("emits no log records when no logger is provided (silent default)", async () => {
    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    // Just confirms no crash / no stray output when logger is omitted.
    const result = await bootSafe({ configPath, inject: false })
    result.fold(
      (err) => expect.unreachable(`Expected Right, got ${err._tag}`),
      (boot) => expect(boot).toBeDefined(),
    )
  })

  it("emits alias.validate.success + phase.fnox.unavailable for a typical boot", async () => {
    const { logger, entries, hasEntry } = createDirectTestLogger()

    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    await bootSafe({ configPath, inject: false, logger })

    expect(hasEntry("debug", "alias.validate.success")).toBe(true)
    expect(hasEntry("debug", "phase.fnox.unavailable")).toBe(true)

    // Every entry should have the component context bound
    entries()
      .toArray()
      .forEach((entry) => {
        expect(entry.metadata?.component).toBe("envpkt.boot")
      })
  })

  it("emits phase.alias.target_unresolved when alias target cannot resolve", async () => {
    const { logger, hasEntry } = createDirectTestLogger()

    const configPath = writeConfig(
      `version = 1\n[secret.TARGET]\nservice = "svc"\n\n[secret.ALIAS]\nfrom_key = "secret.TARGET"\n`,
    )
    await bootSafe({ configPath, inject: false, logger })

    // Target falls to skipped (fnox unavailable), alias copy sees no value
    expect(hasEntry("debug", "phase.alias.target_unresolved")).toBe(true)
  })

  it("emits alias.validate.failed with error tag when config has invalid alias", async () => {
    const { logger, entries } = createDirectTestLogger()

    const configPath = writeConfig(`version = 1\n[secret.ALIAS]\nfrom_key = "secret.NONEXISTENT"\n`)
    await bootSafe({ configPath, inject: false, logger })

    const failures = entries().filter((e) => e.message === "alias.validate.failed")
    expect(failures.size).toBe(1)
    failures.headOption.fold(
      () => expect.unreachable("Expected a failure entry"),
      (entry) => {
        expect(entry.level).toBe("warn")
        expect(entry.metadata?.tag).toBe("AliasTargetMissing")
      },
    )
  })

  it("binds component=envpkt.boot context on every record", async () => {
    const { logger, entries } = createDirectTestLogger()

    const configPath = writeConfig(`version = 1\n[secret.KEY]\nservice = "svc"\n`)
    await bootSafe({ configPath, inject: false, logger })

    const all = entries().toArray()
    expect(all.length).toBeGreaterThan(0)
    all.forEach((entry) => {
      expect(entry.metadata?.component).toBe("envpkt.boot")
    })
  })

  // A crash inside boot is a bug, not a BootError: it must reject with the original error and
  // stack, never come back as a Left (which boot() would print as "Boot error: {}").
  describe("when the logger throws", () => {
    const crash = new Error("logger crashed")
    // Throws from the alias copy pass, which runs after secrets resolve: the last async phase.
    const throwingLogger: DirectLogger = {
      ...directSilentLogger,
      debug: (message) => {
        if (message.startsWith("phase.alias.")) throw crash
      },
      withContext: () => throwingLogger,
    }
    const aliasConfig = `version = 1\n[secret.TARGET]\nservice = "svc"\n\n[secret.ALIAS]\nfrom_key = "secret.TARGET"\n`

    it("bootSafe rejects with the logger's error", async () => {
      const configPath = writeConfig(aliasConfig)
      await expect(bootSafe({ configPath, inject: false, logger: throwingLogger })).rejects.toBe(crash)
    })

    it("boot rejects with the logger's error", async () => {
      const configPath = writeConfig(aliasConfig)
      await expect(boot({ configPath, inject: false, logger: throwingLogger })).rejects.toBe(crash)
    })
  })
})
