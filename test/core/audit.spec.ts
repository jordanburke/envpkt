import { describe, expect, it } from "vitest"

import { computeAudit } from "../../src/core/audit.js"
import type { EnvpktConfig } from "../../src/core/types.js"

const today = new Date("2025-06-15T00:00:00Z")

const makeConfig = (meta: EnvpktConfig["meta"], lifecycle?: EnvpktConfig["lifecycle"]): EnvpktConfig => ({
  version: 1,
  meta,
  lifecycle,
})

describe("computeAudit", () => {
  it("reports healthy for non-expired secrets", () => {
    const config = makeConfig({
      API_KEY: {
        service: "stripe",
        created: "2025-01-01",
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

  it("detects expiring_soon secrets", () => {
    const config = makeConfig(
      {
        SOON_KEY: {
          service: "stripe",
          created: "2025-01-01",
          expires: "2025-07-01",
        },
      },
      { warn_before_days: 30 },
    )

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

  it("detects stale secrets", () => {
    const config = makeConfig(
      {
        ANCIENT: {
          service: "old-db",
          created: "2023-01-01",
        },
      },
      { stale_after_days: 365 },
    )

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("degraded")
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
      HEALTHY: { service: "ok", created: "2025-01-01", expires: "2026-01-01" },
      EXPIRED: { service: "bad", created: "2024-01-01", expires: "2025-01-01" },
      EXPIRING: { service: "soon", created: "2025-01-01", expires: "2025-06-30" },
    })

    const result = computeAudit(config, undefined, today)
    expect(result.status).toBe("critical")
    expect(result.total).toBe(3)
    expect(result.healthy).toBe(1)
    expect(result.expired).toBe(1)
    expect(result.expiring_soon).toBe(1)
  })

  it("returns healthy for empty meta", () => {
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
      { stale_after_days: 365 },
    )

    const result = computeAudit(config, undefined, today)
    const secret = result.secrets.get(0)
    secret.fold(
      () => expect.unreachable("Expected secret"),
      (s) => expect(s.status).toBe("expired"),
    )
  })
})
