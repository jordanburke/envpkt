import { describe, expect, it } from "vitest"

import { envCheck, envScan, generateTomlFromScan } from "../../src/core/env.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const makeConfig = (metaKeys: Record<string, { service?: string }>): EnvpktConfig => ({
  version: 1,
  secret: Object.fromEntries(Object.entries(metaKeys).map(([k, v]) => [k, { service: v.service }])),
})

describe("env core", () => {
  describe("envScan", () => {
    it("discovers credentials from env", () => {
      const env = {
        OPENAI_API_KEY: "sk-test123",
        STRIPE_SECRET_KEY: "sk_live_abc",
        HOME: "/Users/test",
        PATH: "/usr/bin",
      }

      const result = envScan(env)
      expect(result.discovered.size).toBe(2)
      expect(result.high_confidence).toBe(2)
      expect(result.medium_confidence).toBe(0)
      expect(result.total_scanned).toBe(4)
    })

    it("includes medium confidence suffix matches", () => {
      const env = {
        ACME_API_KEY: "random-value",
        CUSTOM_SECRET: "secret-stuff",
      }

      const result = envScan(env)
      expect(result.discovered.size).toBe(2)
      expect(result.medium_confidence).toBe(2)
    })

    it("returns empty for non-credential env", () => {
      const env = {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        NODE_ENV: "production",
      }

      const result = envScan(env)
      expect(result.discovered.size).toBe(0)
      expect(result.total_scanned).toBe(3)
    })

    it("counts confidence levels correctly", () => {
      const env = {
        OPENAI_API_KEY: "sk-test123",
        ACME_API_KEY: "random-value",
      }

      const result = envScan(env)
      expect(result.high_confidence).toBe(1)
      expect(result.medium_confidence).toBe(1)
    })
  })

  describe("envCheck", () => {
    it("reports tracked keys present in env", () => {
      const config = makeConfig({
        OPENAI_API_KEY: { service: "openai" },
      })
      const env = { OPENAI_API_KEY: "sk-test123" }

      const result = envCheck(config, env)
      expect(result.tracked_and_present).toBe(1)
      expect(result.missing_from_env).toBe(0)
      expect(result.untracked_credentials).toBe(0)
      expect(result.is_clean).toBe(true)
    })

    it("reports missing_from_env when TOML key is not in env", () => {
      const config = makeConfig({
        OPENAI_API_KEY: { service: "openai" },
        STRIPE_SECRET_KEY: { service: "stripe" },
      })
      const env = { OPENAI_API_KEY: "sk-test123" }

      const result = envCheck(config, env)
      expect(result.tracked_and_present).toBe(1)
      expect(result.missing_from_env).toBe(1)
      expect(result.is_clean).toBe(false)
    })

    it("reports untracked credentials in env not in TOML", () => {
      const config = makeConfig({
        OPENAI_API_KEY: { service: "openai" },
      })
      const env = {
        OPENAI_API_KEY: "sk-test123",
        STRIPE_SECRET_KEY: "sk_live_abc",
      }

      const result = envCheck(config, env)
      expect(result.tracked_and_present).toBe(1)
      expect(result.untracked_credentials).toBe(1)
      expect(result.is_clean).toBe(false)

      const untracked = result.entries.filter((e) => e.status === "untracked")
      expect(untracked.size).toBe(1)
      expect(untracked.toArray()[0]!.envVar).toBe("STRIPE_SECRET_KEY")
    })

    it("handles empty config and env", () => {
      const config = makeConfig({})
      const result = envCheck(config, {})
      expect(result.is_clean).toBe(true)
      expect(result.entries.size).toBe(0)
    })

    it("detects bidirectional drift", () => {
      const config = makeConfig({
        OPENAI_API_KEY: { service: "openai" },
        MISSING_KEY: { service: "missing-service" },
      })
      const env = {
        OPENAI_API_KEY: "sk-test123",
        GITHUB_TOKEN: "ghp_abc123",
      }

      const result = envCheck(config, env)
      expect(result.tracked_and_present).toBe(1)
      expect(result.missing_from_env).toBe(1)
      expect(result.untracked_credentials).toBe(1)
      expect(result.is_clean).toBe(false)
    })

    it("treats empty string as missing", () => {
      const config = makeConfig({
        OPENAI_API_KEY: { service: "openai" },
      })
      const env = { OPENAI_API_KEY: "" }

      const result = envCheck(config, env)
      expect(result.missing_from_env).toBe(1)
    })
  })

  describe("generateTomlFromScan", () => {
    it("generates TOML blocks for matches", () => {
      const env = {
        OPENAI_API_KEY: "sk-test123",
        STRIPE_SECRET_KEY: "sk_live_abc",
      }

      const scan = envScan(env)
      const toml = generateTomlFromScan(scan.discovered.toArray())

      expect(toml).toContain("[secret.OPENAI_API_KEY]")
      expect(toml).toContain('service = "openai"')
      expect(toml).toContain("[secret.STRIPE_SECRET_KEY]")
      expect(toml).toContain('service = "stripe"')
      expect(toml).toContain("created = ")
    })

    it("generates empty string for empty matches", () => {
      const toml = generateTomlFromScan([])
      expect(toml).toBe("")
    })

    it("includes commented suggestions", () => {
      const env = { OPENAI_API_KEY: "sk-test123" }
      const scan = envScan(env)
      const toml = generateTomlFromScan(scan.discovered.toArray())

      expect(toml).toContain("# purpose")
      expect(toml).toContain("# expires")
      expect(toml).toContain("# rotation_url")
    })
  })
})

describe("envCheck with namespace", () => {
  it("treats a namespaced secret present under its wire name as tracked, not missing or untracked", () => {
    const config: EnvpktConfig = {
      version: 1,
      namespace: { prefix: "CIV" },
      secret: { API_KEY: { service: "stripe" } },
    }
    const env = { CIV__API_KEY: "sk-livetest1234567890" }

    const result = envCheck(config, env)
    const apiEntry = result.entries.toArray().find((e) => e.envVar === "API_KEY")

    expect(apiEntry?.status).toBe("tracked")
    expect(result.untracked_credentials).toBe(0)
  })

  it("treats a namespaced env default present under its wire name as tracked", () => {
    const config: EnvpktConfig = {
      version: 1,
      namespace: { prefix: "CIV" },
      env: { LOG_LEVEL: { value: "info" } },
    }
    const env = { CIV__LOG_LEVEL: "debug" }

    const result = envCheck(config, env)
    const entry = result.entries.toArray().find((e) => e.envVar === "LOG_LEVEL")

    expect(entry?.status).toBe("tracked")
  })

  it("honors a per-entry opt-out: a plain wire name satisfies an opted-out secret", () => {
    const config: EnvpktConfig = {
      version: 1,
      namespace: { prefix: "CIV" },
      secret: { SHARED_TOKEN: { service: "svc", namespace: "" } },
    }
    const env = { SHARED_TOKEN: "sk-livetest1234567890" }

    const result = envCheck(config, env)
    const entry = result.entries.toArray().find((e) => e.envVar === "SHARED_TOKEN")

    expect(entry?.status).toBe("tracked")
    expect(result.untracked_credentials).toBe(0)
  })
})
