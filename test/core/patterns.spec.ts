import { describe, expect, it } from "vitest"

import type { MatchResult } from "../../src/core/patterns.js"
import { deriveServiceFromName, matchEnvVar, matchValueShape, scanEnv } from "../../src/core/patterns.js"

const unwrap = (opt: import("functype").Option<MatchResult>): MatchResult => opt.orThrow(new Error("expected Some"))

const service = (m: MatchResult): string =>
  m.service.fold(
    () => {
      throw new Error("expected service")
    },
    (s) => s,
  )

describe("patterns", () => {
  describe("matchEnvVar — exact name patterns", () => {
    it("matches OPENAI_API_KEY → openai (high)", () => {
      const m = unwrap(matchEnvVar("OPENAI_API_KEY", "sk-test123"))
      expect(service(m)).toBe("openai")
      expect(m.confidence).toBe("high")
      expect(m.matchedBy).toContain("exact")
    })

    it("matches AWS_ACCESS_KEY_ID → aws (high)", () => {
      const m = unwrap(matchEnvVar("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE"))
      expect(service(m)).toBe("aws")
      expect(m.confidence).toBe("high")
    })

    it("matches STRIPE_SECRET_KEY → stripe (high)", () => {
      const m = unwrap(matchEnvVar("STRIPE_SECRET_KEY", "sk_live_abc123"))
      expect(service(m)).toBe("stripe")
    })

    it("matches DATABASE_URL → database (high)", () => {
      const m = unwrap(matchEnvVar("DATABASE_URL", "postgres://localhost/db"))
      expect(service(m)).toBe("database")
    })

    it("matches GITHUB_TOKEN → github (high)", () => {
      const m = unwrap(matchEnvVar("GITHUB_TOKEN", "ghp_abc123"))
      expect(service(m)).toBe("github")
    })

    it("matches SUPABASE_ANON_KEY → supabase (high)", () => {
      const m = unwrap(matchEnvVar("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"))
      expect(service(m)).toBe("supabase")
    })

    it("matches ANTHROPIC_API_KEY → anthropic (high)", () => {
      const m = unwrap(matchEnvVar("ANTHROPIC_API_KEY", "sk-ant-test"))
      expect(service(m)).toBe("anthropic")
    })
  })

  describe("matchEnvVar — value shape patterns", () => {
    it("detects ghp_ prefix → github", () => {
      const m = unwrap(matchEnvVar("MY_CUSTOM_VAR", "ghp_abcdef1234567890"))
      expect(service(m)).toBe("github")
      expect(m.confidence).toBe("high")
      expect(m.matchedBy).toContain("value")
    })

    it("detects sk_live_ prefix → stripe", () => {
      const m = unwrap(matchEnvVar("PAYMENT_KEY", "sk_live_abcdef"))
      expect(service(m)).toBe("stripe")
    })

    it("detects AKIA prefix → aws", () => {
      const m = unwrap(matchEnvVar("SOME_KEY", "AKIAIOSFODNN7EXAMPLE"))
      expect(service(m)).toBe("aws")
    })

    it("detects xoxb- prefix → slack", () => {
      const m = unwrap(matchEnvVar("BOT_CREDENTIAL", "xoxb-123-456-abc"))
      expect(service(m)).toBe("slack")
    })

    it("detects postgres:// → postgresql", () => {
      const m = unwrap(matchEnvVar("DB_CONN", "postgres://user:pass@host/db"))
      expect(service(m)).toBe("postgresql")
    })

    it("detects eyJ → jwt", () => {
      const m = unwrap(matchEnvVar("AUTH_HEADER", "eyJhbGciOiJIUzI1NiJ9.payload.sig"))
      expect(service(m)).toBe("jwt")
    })

    it("detects SG. → sendgrid", () => {
      const m = unwrap(matchEnvVar("MAIL_KEY", "SG.abcdefg12345"))
      expect(service(m)).toBe("sendgrid")
    })

    it("detects mongodb+srv:// → mongodb", () => {
      const m = unwrap(matchEnvVar("MONGO_CONN", "mongodb+srv://user:pass@cluster.mongodb.net/db"))
      expect(service(m)).toBe("mongodb")
    })
  })

  describe("matchEnvVar — generic suffix patterns (medium confidence)", () => {
    it("matches *_API_KEY → derives service from name", () => {
      const m = unwrap(matchEnvVar("ACME_API_KEY", "some-random-value"))
      expect(m.confidence).toBe("medium")
      expect(service(m)).toBe("acme")
      expect(m.matchedBy).toContain("suffix")
    })

    it("matches *_SECRET → derives service", () => {
      const m = unwrap(matchEnvVar("MY_APP_SECRET", "secret123"))
      expect(m.confidence).toBe("medium")
      expect(service(m)).toBe("my-app")
    })

    it("matches *_TOKEN → derives service", () => {
      const m = unwrap(matchEnvVar("CUSTOM_SERVICE_TOKEN", "tok_abc"))
      expect(m.confidence).toBe("medium")
      expect(service(m)).toBe("custom-service")
    })

    it("matches *_PASSWORD → derives service", () => {
      const m = unwrap(matchEnvVar("POSTGRES_PASSWORD", "p@ssw0rd"))
      expect(m.confidence).toBe("medium")
      expect(service(m)).toBe("postgres")
    })

    it("matches *_DSN → derives service", () => {
      // SENTRY_DSN is an exact match, so it should be high confidence
      const m = unwrap(matchEnvVar("SENTRY_DSN", "https://abc@sentry.io/123"))
      expect(m.confidence).toBe("high")
    })
  })

  describe("matchEnvVar — exclusions", () => {
    it("excludes PATH", () => {
      expect(matchEnvVar("PATH", "/usr/bin:/bin").isNone()).toBe(true)
    })

    it("excludes HOME", () => {
      expect(matchEnvVar("HOME", "/Users/test").isNone()).toBe(true)
    })

    it("excludes NODE_ENV", () => {
      expect(matchEnvVar("NODE_ENV", "production").isNone()).toBe(true)
    })

    it("excludes SHELL", () => {
      expect(matchEnvVar("SHELL", "/bin/zsh").isNone()).toBe(true)
    })

    it("excludes NVM_DIR", () => {
      expect(matchEnvVar("NVM_DIR", "/Users/test/.nvm").isNone()).toBe(true)
    })
  })

  describe("matchEnvVar — no match", () => {
    it("returns None for unknown vars without credential patterns", () => {
      expect(matchEnvVar("MY_APP_PORT", "3000").isNone()).toBe(true)
    })

    it("returns None for empty values", () => {
      // Empty string is filtered in scanEnv, but matchEnvVar should still not match
      // because the value doesn't match any value shapes and name has no credential suffix
      expect(matchEnvVar("MY_APP_PORT", "").isNone()).toBe(true)
    })
  })

  describe("matchEnvVar — priority: exact > value > suffix", () => {
    it("prefers exact name match over value shape", () => {
      // OPENAI_API_KEY is an exact match AND value starts with sk-
      const m = unwrap(matchEnvVar("OPENAI_API_KEY", "sk-test123"))
      expect(m.matchedBy).toContain("exact")
      expect(service(m)).toBe("openai")
    })

    it("prefers value shape over suffix when no exact match", () => {
      // Not an exact match, but value looks like a GitHub token
      const m = unwrap(matchEnvVar("CUSTOM_TOKEN", "ghp_abc123"))
      expect(m.matchedBy).toContain("value")
      expect(service(m)).toBe("github")
    })
  })

  describe("deriveServiceFromName", () => {
    it("strips _API_KEY and lowercases", () => {
      expect(deriveServiceFromName("ACME_API_KEY")).toBe("acme")
    })

    it("strips _SECRET_KEY and hyphenates", () => {
      expect(deriveServiceFromName("MY_APP_SECRET_KEY")).toBe("my-app")
    })

    it("strips _TOKEN", () => {
      expect(deriveServiceFromName("CUSTOM_SERVICE_TOKEN")).toBe("custom-service")
    })

    it("strips _PASSWORD", () => {
      expect(deriveServiceFromName("DB_PASSWORD")).toBe("db")
    })

    it("handles single word", () => {
      expect(deriveServiceFromName("CREDENTIALS_SECRET")).toBe("credentials")
    })

    it("handles name with no matching suffix", () => {
      expect(deriveServiceFromName("SOMETHING")).toBe("something")
    })
  })

  describe("matchValueShape", () => {
    it("matches sk- prefix → openai", () => {
      const result = matchValueShape("sk-test123")
      expect(result.isSome()).toBe(true)
      result.fold(
        () => expect.unreachable("expected Some"),
        (v) => expect(v.service).toBe("openai"),
      )
    })

    it("matches sk-ant- prefix → anthropic (more specific wins)", () => {
      const result = matchValueShape("sk-ant-test123")
      expect(result.isSome()).toBe(true)
      result.fold(
        () => expect.unreachable("expected Some"),
        (v) => expect(v.service).toBe("anthropic"),
      )
    })

    it("returns None for no match", () => {
      expect(matchValueShape("just-a-regular-value").isNone()).toBe(true)
    })
  })

  describe("scanEnv", () => {
    it("scans an env object and returns sorted matches", () => {
      const env = {
        OPENAI_API_KEY: "sk-test123",
        PATH: "/usr/bin",
        ACME_API_KEY: "random-value",
        HOME: "/Users/test",
        STRIPE_SECRET_KEY: "sk_live_abc",
      }

      const results = scanEnv(env)
      expect(results.length).toBeGreaterThanOrEqual(3)

      const highConfidence = results.filter((r) => r.confidence === "high")
      const mediumConfidence = results.filter((r) => r.confidence === "medium")

      expect(highConfidence.length).toBeGreaterThanOrEqual(2)

      if (mediumConfidence.length > 0) {
        const lastHighIdx = results.findLastIndex((r) => r.confidence === "high")
        const firstMediumIdx = results.findIndex((r) => r.confidence === "medium")
        expect(lastHighIdx).toBeLessThan(firstMediumIdx)
      }
    })

    it("skips undefined and empty values", () => {
      const env = {
        OPENAI_API_KEY: undefined,
        STRIPE_SECRET_KEY: "",
        GITHUB_TOKEN: "ghp_valid",
      }

      const results = scanEnv(env)
      expect(results.length).toBe(1)
      expect(results[0]!.envVar).toBe("GITHUB_TOKEN")
    })

    it("excludes non-credential env vars", () => {
      const env = {
        PATH: "/usr/bin",
        HOME: "/Users/test",
        NODE_ENV: "production",
        SHELL: "/bin/zsh",
      }

      const results = scanEnv(env)
      expect(results.length).toBe(0)
    })

    it("sorts alphabetically within same confidence level", () => {
      const env = {
        STRIPE_SECRET_KEY: "sk_live_abc",
        ANTHROPIC_API_KEY: "sk-ant-test",
        OPENAI_API_KEY: "sk-test123",
      }

      const results = scanEnv(env)
      const names = results.map((r) => r.envVar)
      expect(names).toEqual([...names].sort())
    })
  })
})
