import { describe, expect, it } from "vitest"

import { envCheck, envScan, generateTomlFromScan } from "../../src/core/env.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const makeConfig = (metaKeys: Record<string, { service?: string }>): EnvpktConfig => ({
  version: 1,
  meta: Object.fromEntries(Object.entries(metaKeys).map(([k, v]) => [k, { service: v.service }])),
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

      expect(toml).toContain("[meta.OPENAI_API_KEY]")
      expect(toml).toContain('service = "openai"')
      expect(toml).toContain("[meta.STRIPE_SECRET_KEY]")
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
