import type { EnvpktConfig, ResolveResult } from "../../src/core/types.js"

// ---------------------------------------------------------------------------
// Helper: build a ResolveResult from a config with sensible defaults
// ---------------------------------------------------------------------------

export const makeResult = (config: EnvpktConfig, overrides?: Partial<ResolveResult>): ResolveResult => ({
  config,
  merged: [],
  overridden: [],
  warnings: [],
  ...overrides,
})

// ---------------------------------------------------------------------------
// Fake secret values — realistic formats, obviously not real credentials
// ---------------------------------------------------------------------------

export const demoSecrets: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgres://envpkt_app:s3cur3-p4ss@db.internal:5432/myapp",
  STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnopqrst",
  REDIS_URL: "redis://:r3d1s-t0k3n@cache.internal:6379/0",
  DATADOG_API_KEY: "dd-api-7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
}

// ---------------------------------------------------------------------------
// api-gateway — resolved via catalog, no overrides, no lifecycle
// ---------------------------------------------------------------------------

export const apiGatewayResult: ResolveResult = {
  config: {
    version: 1,
    agent: {
      name: "api-gateway",
      consumer: "service",
      description: "REST API — handles payments and database writes",
      capabilities: ["http:serve", "payments:process"],
    },
    meta: {
      DATABASE_URL: {
        service: "postgres",
        purpose: "Primary application database",
        capabilities: ["SELECT", "INSERT", "UPDATE", "DELETE"],
        rotation_url: "https://wiki.internal/runbooks/rotate-db",
        source: "vault",
        created: "2026-01-15",
        expires: "2027-01-15",
        rotates: "90d",
      },
      STRIPE_SECRET_KEY: {
        service: "stripe",
        purpose: "Payment processing",
        capabilities: ["charges:write", "subscriptions:read"],
        rotation_url: "https://dashboard.stripe.com/apikeys",
        created: "2026-02-01",
        expires: "2027-02-01",
        rate_limit: "100/sec",
        source: "vault",
      },
    },
  },
  catalogPath: "CATALOG_PATH_PLACEHOLDER",
  merged: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
  overridden: [],
  warnings: [],
}

// ---------------------------------------------------------------------------
// data-pipeline — resolved via catalog, DATABASE_URL overridden to SELECT
// ---------------------------------------------------------------------------

export const dataPipelineResult: ResolveResult = {
  config: {
    version: 1,
    agent: {
      name: "data-pipeline",
      consumer: "agent",
      description: "ETL pipeline — reads from Postgres, caches in Redis",
      capabilities: ["extract", "transform", "load"],
    },
    meta: {
      DATABASE_URL: {
        service: "postgres",
        purpose: "Primary application database",
        capabilities: ["SELECT"],
        rotation_url: "https://wiki.internal/runbooks/rotate-db",
        source: "vault",
        created: "2026-01-15",
        expires: "2027-01-15",
        rotates: "90d",
      },
      REDIS_URL: {
        service: "redis",
        purpose: "Caching and session storage",
        capabilities: ["GET", "SET", "DEL"],
        created: "2026-01-15",
        expires: "2027-01-15",
        source: "vault",
      },
    },
  },
  catalogPath: "CATALOG_PATH_PLACEHOLDER",
  merged: ["DATABASE_URL", "REDIS_URL"],
  overridden: ["DATABASE_URL"],
  warnings: [],
}

// ---------------------------------------------------------------------------
// sealed-agent — standalone with sealed (encrypted_value) secrets
// ---------------------------------------------------------------------------

export const sealedAgentResult: ResolveResult = {
  config: {
    version: 1,
    agent: {
      name: "sealed-agent",
      consumer: "agent",
      description: "Agent with sealed secrets for offline operation",
      capabilities: ["inference"],
      recipient: "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p",
      identity: "identity.age",
    },
    meta: {
      OPENAI_API_KEY: {
        service: "openai",
        purpose: "LLM inference",
        capabilities: ["chat:completions"],
        created: "2026-01-15",
        expires: "2027-01-15",
        encrypted_value: "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24=\n-----END AGE ENCRYPTED FILE-----",
      },
      ANTHROPIC_API_KEY: {
        service: "anthropic",
        purpose: "Claude inference",
        capabilities: ["messages:create"],
        created: "2026-02-01",
        expires: "2027-02-01",
        encrypted_value: "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVuY3J5cHRpb24=\n-----END AGE ENCRYPTED FILE-----",
      },
    },
  },
  merged: [],
  overridden: [],
  warnings: [],
}

// ---------------------------------------------------------------------------
// monitoring — standalone, no catalog, lifecycle, expired DATADOG_API_KEY
// ---------------------------------------------------------------------------

export const monitoringResult: ResolveResult = {
  config: {
    version: 1,
    agent: {
      name: "monitoring",
      consumer: "agent",
      description: "Infrastructure health checks and alerting",
      capabilities: ["monitor", "alert"],
    },
    meta: {
      DATADOG_API_KEY: {
        service: "datadog",
        purpose: "Infrastructure monitoring metrics",
        capabilities: ["metrics:write", "events:write"],
        created: "2025-06-01",
        expires: "2026-01-01",
        rotation_url: "https://app.datadoghq.com/organization-settings/api-keys",
        source: "ci",
      },
      SLACK_WEBHOOK_URL: {
        service: "slack",
        purpose: "Alert notifications to #ops-alerts channel",
        capabilities: ["post:messages"],
        created: "2026-01-15",
        expires: "2027-01-15",
        source: "ci",
      },
    },
    lifecycle: {
      stale_warning_days: 60,
    },
  },
  merged: [],
  overridden: [],
  warnings: [],
}
