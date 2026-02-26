import { describe, expect, it } from "vitest"

import { formatPacket } from "../../src/core/format.js"
import type { FormatPacketOptions } from "../../src/core/format.js"
import { apiGatewayResult, dataPipelineResult, demoSecrets, monitoringResult } from "../fixtures/demo-data.js"

// Use a stable catalog path for golden comparisons
const apiGw = { ...apiGatewayResult, catalogPath: "/infra/envpkt.toml" }
const dataPl = { ...dataPipelineResult, catalogPath: "/infra/envpkt.toml" }

// Per-agent secret subsets
const apiSecrets = { DATABASE_URL: demoSecrets.DATABASE_URL, STRIPE_SECRET_KEY: demoSecrets.STRIPE_SECRET_KEY }
const dpSecrets = { DATABASE_URL: demoSecrets.DATABASE_URL, REDIS_URL: demoSecrets.REDIS_URL }
const monSecrets = { DATADOG_API_KEY: demoSecrets.DATADOG_API_KEY, SLACK_WEBHOOK_URL: demoSecrets.SLACK_WEBHOOK_URL }

describe("formatPacket golden output", () => {
  // -----------------------------------------------------------------------
  // api-gateway
  // -----------------------------------------------------------------------

  describe("api-gateway", () => {
    it("no secrets", () => {
      expect(formatPacket(apiGw)).toBe(
        `envpkt packet: api-gateway (service)

  REST API — handles payments and database writes
  capabilities: http:serve, payments:process

secrets: 2
  DATABASE_URL → postgres
    purpose: Primary application database
    capabilities: SELECT, INSERT, UPDATE, DELETE
    created: 2026-01-15  expires: 2027-01-15
    rotates: 90d
    source: vault
    rotation_url: https://wiki.internal/runbooks/rotate-db
  STRIPE_SECRET_KEY → stripe
    purpose: Payment processing
    capabilities: charges:write, subscriptions:read
    created: 2026-02-01  expires: 2027-02-01
    rate_limit: 100/sec
    source: vault
    rotation_url: https://dashboard.stripe.com/apikeys

catalog: /infra/envpkt.toml
  merged: 2 keys
  overridden: (none)`,
      )
    })

    it("encrypted secrets", () => {
      const output = formatPacket(apiGw, { secrets: apiSecrets })
      expect(output).toContain("DATABASE_URL → postgres = pos•••••yapp")
      expect(output).toContain("STRIPE_SECRET_KEY → stripe = sk_•••••qrst")
      expect(output).not.toContain("postgres://")
      expect(output).not.toContain("sk_live_")
    })

    it("plaintext secrets", () => {
      const opts: FormatPacketOptions = { secrets: apiSecrets, secretDisplay: "plaintext" }
      const output = formatPacket(apiGw, opts)
      expect(output).toContain("DATABASE_URL → postgres = postgres://envpkt_app:s3cur3-p4ss@db.internal:5432/myapp")
      expect(output).toContain("STRIPE_SECRET_KEY → stripe = sk_live_abcdefghijklmnopqrst")
    })
  })

  // -----------------------------------------------------------------------
  // data-pipeline
  // -----------------------------------------------------------------------

  describe("data-pipeline", () => {
    it("no secrets — shows override and narrowed capabilities", () => {
      expect(formatPacket(dataPl)).toBe(
        `envpkt packet: data-pipeline (agent)

  ETL pipeline — reads from Postgres, caches in Redis
  capabilities: extract, transform, load

secrets: 2
  DATABASE_URL → postgres
    purpose: Primary application database
    capabilities: SELECT
    created: 2026-01-15  expires: 2027-01-15
    rotates: 90d
    source: vault
    rotation_url: https://wiki.internal/runbooks/rotate-db
  REDIS_URL → redis
    purpose: Caching and session storage
    capabilities: GET, SET, DEL
    created: 2026-01-15  expires: 2027-01-15
    source: vault

catalog: /infra/envpkt.toml
  merged: 2 keys
  overridden: DATABASE_URL`,
      )
    })

    it("encrypted secrets", () => {
      const output = formatPacket(dataPl, { secrets: dpSecrets })
      expect(output).toContain("DATABASE_URL → postgres = pos•••••yapp")
      expect(output).toContain("REDIS_URL → redis = red•••••79/0")
    })

    it("plaintext secrets", () => {
      const opts: FormatPacketOptions = { secrets: dpSecrets, secretDisplay: "plaintext" }
      const output = formatPacket(dataPl, opts)
      expect(output).toContain("DATABASE_URL → postgres = postgres://envpkt_app:s3cur3-p4ss@db.internal:5432/myapp")
      expect(output).toContain("REDIS_URL → redis = redis://:r3d1s-t0k3n@cache.internal:6379/0")
    })
  })

  // -----------------------------------------------------------------------
  // monitoring
  // -----------------------------------------------------------------------

  describe("monitoring", () => {
    it("no secrets — shows lifecycle and expired date", () => {
      expect(formatPacket(monitoringResult)).toBe(
        `envpkt packet: monitoring (agent)

  Infrastructure health checks and alerting
  capabilities: monitor, alert

secrets: 2
  DATADOG_API_KEY → datadog
    purpose: Infrastructure monitoring metrics
    capabilities: metrics:write, events:write
    created: 2025-06-01  expires: 2026-01-01
    source: ci
    rotation_url: https://app.datadoghq.com/organization-settings/api-keys
  SLACK_WEBHOOK_URL → slack
    purpose: Alert notifications to #ops-alerts channel
    capabilities: post:messages
    created: 2026-01-15  expires: 2027-01-15
    source: ci

lifecycle:
  stale_warning_days: 60`,
      )
    })

    it("encrypted secrets", () => {
      const output = formatPacket(monitoringResult, { secrets: monSecrets })
      expect(output).toContain("DATADOG_API_KEY → datadog = dd-•••••1b2c")
      expect(output).toContain("SLACK_WEBHOOK_URL → slack = htt•••••xxxx")
    })

    it("plaintext secrets", () => {
      const opts: FormatPacketOptions = { secrets: monSecrets, secretDisplay: "plaintext" }
      const output = formatPacket(monitoringResult, opts)
      expect(output).toContain("DATADOG_API_KEY → datadog = dd-api-7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c")
      expect(output).toContain(
        "SLACK_WEBHOOK_URL → slack = https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      )
    })
  })
})
