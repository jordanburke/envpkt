import { describe, expect, it } from "vitest"

import { computeAudit, computeEnvAudit } from "../../src/core/audit.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const today = new Date("2025-06-15T00:00:00Z")

const makeConfig = (secret: EnvpktConfig["secret"], lifecycle?: EnvpktConfig["lifecycle"]): EnvpktConfig => ({
  version: 1,
  secret,
  lifecycle,
})

describe("computeAudit", () => {
  it("reports healthy for non-expired secrets", () => {
    const config = makeConfig({
      API_KEY: {
        service: "stripe",
        created: "2025-04-01",
        expires: "2026-01-01",
      },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("healthy")
    expect(result.total).toBe(1)
    expect(result.healthy).toBe(1)
    expect(result.expired).toBe(0)
  })

  it("detects expired secrets", () => {
    const config = makeConfig({
      OLD_KEY: {
        service: "legacy",
        created: "2024-01-01",
        expires: "2025-01-01",
      },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("critical")
    expect(result.expired).toBe(1)

    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => {
        expect(s.status).toBe("expired")
        expect(s.days_remaining.isSome()).toBe(true)
        s.days_remaining.fold(
          () => expect.unreachable("Expected days_remaining"),
          (d) => expect(d).toBeLessThan(0),
        )
      },
    )
  })

  it("detects expiring_soon secrets (hardcoded 30-day warning)", () => {
    const config = makeConfig({
      SOON_KEY: {
        service: "stripe",
        created: "2025-01-01",
        expires: "2025-07-01",
      },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("degraded")
    expect(result.expiring_soon).toBe(1)

    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => {
        expect(s.status).toBe("expiring_soon")
        s.days_remaining.fold(
          () => expect.unreachable("Expected days_remaining"),
          (d) => {
            expect(d).toBeGreaterThanOrEqual(0)
            expect(d).toBeLessThanOrEqual(30)
          },
        )
      },
    )
  })

  it("detects stale secrets using stale_warning_days (default 90)", () => {
    const config = makeConfig(
      {
        ANCIENT: {
          service: "old-db",
          created: "2023-01-01",
        },
      },
      { stale_warning_days: 365 },
    )

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("degraded")
    expect(result.stale).toBe(1)
  })

  it("uses default stale_warning_days of 90", () => {
    // Created 100 days ago — stale with default 90-day threshold
    const config = makeConfig({
      STALE_KEY: {
        service: "svc",
        created: "2025-03-07",
      },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.stale).toBe(1)
  })

  it("detects missing secrets when fnox keys are provided", () => {
    const config = makeConfig({
      KNOWN_KEY: { service: "api" },
      UNKNOWN_KEY: { service: "mystery" },
    })

    const fnoxKeys = new Set(["KNOWN_KEY"])
    const result = computeAudit(config, fnoxKeys, today)

    expect(result.status).toBe("critical")
    expect(result.missing).toBe(1)

    const missing = result.secrets.find((s) => s.key === "UNKNOWN_KEY")
    missing.fold(
      () => expect.unreachable("Expected to find UNKNOWN_KEY"),
      (s) => expect(s.status).toBe("missing"),
    )
  })

  it("handles mixed statuses correctly", () => {
    const config = makeConfig({
      HEALTHY: { service: "ok", created: "2025-04-01", expires: "2026-01-01" },
      EXPIRED: { service: "bad", created: "2024-01-01", expires: "2025-01-01" },
      EXPIRING: { service: "soon", created: "2025-04-01", expires: "2025-06-30" },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("critical")
    expect(result.total).toBe(3)
    expect(result.healthy).toBe(1)
    expect(result.expired).toBe(1)
    expect(result.expiring_soon).toBe(1)
  })

  it("returns healthy for empty secret", () => {
    const config = makeConfig({})
    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("healthy")
    expect(result.total).toBe(0)
  })

  it("handles secrets with no dates", () => {
    const config = makeConfig({
      NO_DATES: { service: "whatever" },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("healthy")

    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => {
        expect(s.days_remaining.isNone()).toBe(true)
        expect(s.expires.isNone()).toBe(true)
        expect(s.created.isNone()).toBe(true)
      },
    )
  })

  it("expired takes priority over stale", () => {
    const config = makeConfig(
      {
        OLD_AND_EXPIRED: {
          service: "legacy",
          created: "2022-01-01",
          expires: "2024-12-31",
        },
      },
      { stale_warning_days: 365 },
    )

    const result = computeAudit(config, undefined, today)
    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => expect(s.status).toBe("expired"),
    )
  })

  it("detects missing_metadata when require_expiration is set", () => {
    const config = makeConfig(
      {
        NO_EXPIRY: { service: "svc" },
      },
      { require_expiration: true },
    )

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("degraded")
    expect(result.missing_metadata).toBe(1)

    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => expect(s.status).toBe("missing_metadata"),
    )
  })

  it("detects missing_metadata when require_service is set", () => {
    const config = makeConfig(
      {
        NO_SERVICE: { expires: "2026-01-01" },
      },
      { require_service: true },
    )

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("degraded")
    expect(result.missing_metadata).toBe(1)
  })

  it("does not flag missing_metadata when requirements are met", () => {
    const config = makeConfig(
      {
        COMPLETE: { service: "svc", expires: "2026-01-01" },
      },
      { require_expiration: true, require_service: true },
    )

    const result = computeAudit(config, undefined, today)
    expect(result.missing_metadata).toBe(0)
    expect(result.status).toBe("healthy")
  })

  it("counts orphaned keys when fnox keys provided", () => {
    const config = makeConfig({
      IN_FNOX: { service: "svc" },
      NOT_IN_FNOX: { service: "other" },
    })

    const fnoxKeys = new Set(["IN_FNOX", "EXTRA_FNOX_KEY"])
    const result = computeAudit(config, fnoxKeys, today)
    // NOT_IN_FNOX is missing from fnox (orphaned) AND classified as "missing"
    expect(result.orphaned).toBe(1)
  })

  it("returns zero orphaned when no fnox keys", () => {
    const config = makeConfig({
      KEY: { service: "svc" },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.orphaned).toBe(0)
  })

  it("includes identity in audit result", () => {
    const config: EnvpktConfig = {
      version: 1,
      identity: { name: "test-agent", consumer: "agent" },
      secret: { KEY: { service: "svc" } },
    }

    const result = computeAudit(config, undefined, today)
    expect(result.identity?.name).toBe("test-agent")
    expect(result.identity?.consumer).toBe("agent")
  })

  it("service is Option in SecretHealth", () => {
    const config = makeConfig({
      NO_SVC: { purpose: "testing" },
      HAS_SVC: { service: "postgres" },
    })

    const result = computeAudit(config, undefined, today)
    const noSvc = result.secrets.find((s) => s.key === "NO_SVC")
    noSvc.fold(
      () => expect.unreachable("Expected NO_SVC"),
      (s) => expect(s.service.isNone()).toBe(true),
    )

    const hasSvc = result.secrets.find((s) => s.key === "HAS_SVC")
    hasSvc.fold(
      () => expect.unreachable("Expected HAS_SVC"),
      (s) =>
        s.service.fold(
          () => expect.unreachable("Expected service"),
          (svc) => expect(svc).toBe("postgres"),
        ),
    )
  })
})

describe("computeEnvAudit", () => {
  it("detects env defaults using default value", () => {
    const config: EnvpktConfig = {
      version: 1,
      env: {
        PORT: { value: "3000", purpose: "App port" },
      },
    }

    const result = computeEnvAudit(config, { PORT: "3000" })
    expect(result.total).toBe(1)
    expect(result.defaults_applied).toBe(1)
    expect(result.entries[0]!.status).toBe("default")
  })

  it("detects overridden env defaults", () => {
    const config: EnvpktConfig = {
      version: 1,
      env: {
        PORT: { value: "3000" },
      },
    }

    const result = computeEnvAudit(config, { PORT: "8080" })
    expect(result.overridden).toBe(1)
    expect(result.entries[0]!.status).toBe("overridden")
    expect(result.entries[0]!.currentValue).toBe("8080")
  })

  it("detects missing env vars", () => {
    const config: EnvpktConfig = {
      version: 1,
      env: {
        PORT: { value: "3000" },
      },
    }

    const result = computeEnvAudit(config, {})
    expect(result.missing).toBe(1)
    expect(result.entries[0]!.status).toBe("missing")
  })

  it("handles empty env config", () => {
    const config: EnvpktConfig = { version: 1 }

    const result = computeEnvAudit(config, {})
    expect(result.total).toBe(0)
    expect(result.entries).toEqual([])
  })

  it("reports purpose in drift entries", () => {
    const config: EnvpktConfig = {
      version: 1,
      env: {
        NODE_ENV: { value: "production", purpose: "Runtime environment" },
      },
    }

    const result = computeEnvAudit(config, { NODE_ENV: "production" })
    expect(result.entries[0]!.purpose).toBe("Runtime environment")
  })
})
