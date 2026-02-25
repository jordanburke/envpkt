import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadCatalog, resolveConfig, resolveSecrets } from "../../src/core/catalog.js"
import type { EnvpktConfig, SecretMeta } from "../../src/core/types.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-catalog-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const writeCatalog = (content: string): string => {
  const path = join(tmpDir, "catalog.toml")
  writeFileSync(path, content)
  return path
}

const writeAgent = (content: string, subdir?: string): string => {
  const dir = subdir ? join(tmpDir, subdir) : tmpDir
  if (subdir) mkdirSync(dir, { recursive: true })
  const path = join(dir, "envpkt.toml")
  writeFileSync(path, content)
  return path
}

describe("loadCatalog", () => {
  it("loads a valid catalog", () => {
    const path = writeCatalog(`version = 1\n[meta.KEY]\nservice = "svc"\n`)
    const result = loadCatalog(path)

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (config) => {
        expect(config.version).toBe(1)
        expect(config.meta.KEY?.service).toBe("svc")
      },
    )
  })

  it("returns CatalogNotFound for missing file", () => {
    const result = loadCatalog("/nonexistent/catalog.toml")

    result.fold(
      (err) => {
        expect(err._tag).toBe("CatalogNotFound")
        if (err._tag === "CatalogNotFound") {
          expect(err.path).toContain("nonexistent")
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns CatalogLoadError for invalid TOML", () => {
    const path = writeCatalog("not valid [[[")
    const result = loadCatalog(path)

    result.fold(
      (err) => expect(err._tag).toBe("CatalogLoadError"),
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("resolveSecrets", () => {
  const catalogMeta: Record<string, SecretMeta> = {
    DB_URL: { service: "postgres", purpose: "Database", capabilities: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
    REDIS: { service: "redis", purpose: "Cache" },
  }

  it("merges all secrets from catalog", () => {
    const result = resolveSecrets({}, catalogMeta, ["DB_URL", "REDIS"], "/catalog.toml")

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (resolved) => {
        expect(Object.keys(resolved)).toEqual(["DB_URL", "REDIS"])
        expect(resolved.DB_URL?.service).toBe("postgres")
        expect(resolved.REDIS?.service).toBe("redis")
      },
    )
  })

  it("shallow merges agent overrides", () => {
    const agentMeta: Record<string, SecretMeta> = {
      DB_URL: { capabilities: ["SELECT"] },
    }
    const result = resolveSecrets(agentMeta, catalogMeta, ["DB_URL"], "/catalog.toml")

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (resolved) => {
        expect(resolved.DB_URL?.capabilities).toEqual(["SELECT"])
        expect(resolved.DB_URL?.service).toBe("postgres")
        expect(resolved.DB_URL?.purpose).toBe("Database")
      },
    )
  })

  it("returns SecretNotInCatalog for missing key", () => {
    const result = resolveSecrets({}, catalogMeta, ["MISSING_KEY"], "/catalog.toml")

    result.fold(
      (err) => {
        expect(err._tag).toBe("SecretNotInCatalog")
        if (err._tag === "SecretNotInCatalog") {
          expect(err.key).toBe("MISSING_KEY")
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })
})

describe("resolveConfig", () => {
  it("passes through config with no catalog field (backward compatible)", () => {
    const config: EnvpktConfig = {
      version: 1,
      meta: { KEY: { service: "svc" } },
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (r) => {
        expect(r.config).toEqual(config)
        expect(r.merged).toEqual([])
        expect(r.overridden).toEqual([])
        expect(r.catalogPath).toBeUndefined()
      },
    )
  })

  it("resolves catalog + secrets into flat config", () => {
    writeCatalog(
      `version = 1\n[meta.DB_URL]\nservice = "postgres"\npurpose = "Database"\n[meta.REDIS]\nservice = "redis"\n`,
    )

    const config: EnvpktConfig = {
      version: 1,
      catalog: "catalog.toml",
      agent: { name: "test-agent", consumer: "agent", secrets: ["DB_URL", "REDIS"] },
      meta: {},
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (r) => {
        expect(r.config.meta.DB_URL?.service).toBe("postgres")
        expect(r.config.meta.REDIS?.service).toBe("redis")
        expect(r.merged).toEqual(["DB_URL", "REDIS"])
        expect(r.overridden).toEqual([])
        expect(r.catalogPath).toContain("catalog.toml")
        // Resolved config should not have catalog or agent.secrets
        expect(r.config.catalog).toBeUndefined()
        expect(r.config.agent?.secrets).toBeUndefined()
      },
    )
  })

  it("returns MissingSecretsList when catalog set but no agent.secrets", () => {
    writeCatalog(`version = 1\n[meta.KEY]\nservice = "svc"\n`)

    const config: EnvpktConfig = {
      version: 1,
      catalog: "catalog.toml",
      agent: { name: "test-agent" },
      meta: {},
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect(err._tag).toBe("MissingSecretsList"),
      () => expect.unreachable("Expected Left"),
    )
  })

  it("returns SecretNotInCatalog for unknown secret key", () => {
    writeCatalog(`version = 1\n[meta.KEY]\nservice = "svc"\n`)

    const config: EnvpktConfig = {
      version: 1,
      catalog: "catalog.toml",
      agent: { name: "test-agent", secrets: ["NONEXISTENT"] },
      meta: {},
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => {
        expect(err._tag).toBe("SecretNotInCatalog")
        if (err._tag === "SecretNotInCatalog") {
          expect(err.key).toBe("NONEXISTENT")
        }
      },
      () => expect.unreachable("Expected Left"),
    )
  })

  it("applies agent override with shallow merge", () => {
    writeCatalog(
      `version = 1\n[meta.DB]\nservice = "postgres"\npurpose = "Database"\ncapabilities = ["SELECT", "INSERT", "UPDATE", "DELETE"]\n`,
    )

    const config: EnvpktConfig = {
      version: 1,
      catalog: "catalog.toml",
      agent: { name: "read-only-agent", secrets: ["DB"] },
      meta: { DB: { capabilities: ["SELECT"] } },
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (r) => {
        expect(r.config.meta.DB?.capabilities).toEqual(["SELECT"])
        expect(r.config.meta.DB?.service).toBe("postgres")
        expect(r.config.meta.DB?.purpose).toBe("Database")
        expect(r.overridden).toEqual(["DB"])
      },
    )
  })

  it("preserves lifecycle/callbacks/tools from agent config", () => {
    writeCatalog(`version = 1\n[meta.KEY]\nservice = "svc"\n`)

    const config: EnvpktConfig = {
      version: 1,
      catalog: "catalog.toml",
      agent: { name: "agent", secrets: ["KEY"] },
      meta: {},
      lifecycle: { stale_warning_days: 30 },
      callbacks: { on_expired: "https://hooks.example.com/expired" },
      tools: { fnox: true },
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect.unreachable(`Expected Right, got: ${err._tag}`),
      (r) => {
        expect(r.config.lifecycle?.stale_warning_days).toBe(30)
        expect(r.config.callbacks?.on_expired).toBe("https://hooks.example.com/expired")
        expect(r.config.tools?.fnox).toBe(true)
      },
    )
  })

  it("returns CatalogNotFound for missing catalog file", () => {
    const config: EnvpktConfig = {
      version: 1,
      catalog: "nonexistent.toml",
      agent: { name: "agent", secrets: ["KEY"] },
      meta: {},
    }
    const result = resolveConfig(config, tmpDir)

    result.fold(
      (err) => expect(err._tag).toBe("CatalogNotFound"),
      () => expect.unreachable("Expected Left"),
    )
  })
})
