import { Cond, List, Option } from "functype"

import type { EnvpktConfig } from "./schema.js"
import type { AuditResult, HealthStatus, SecretHealth, SecretStatus } from "./types.js"

const MS_PER_DAY = 86_400_000
const WARN_BEFORE_DAYS = 30

const daysBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)

const parseDate = (dateStr: string): Option<Date> => {
  const d = new Date(dateStr + "T00:00:00Z")
  return Number.isNaN(d.getTime()) ? Option<Date>(undefined) : Option(d)
}

const classifySecret = (
  key: string,
  meta: EnvpktConfig["meta"][string],
  fnoxKeys: ReadonlySet<string>,
  staleWarningDays: number,
  requireExpiration: boolean,
  requireService: boolean,
  today: Date,
): SecretHealth => {
  const issues: string[] = []

  const created = Option(meta?.created).flatMap(parseDate)
  const expires = Option(meta?.expires).flatMap(parseDate)
  const rotationUrl = Option(meta?.rotation_url)
  const purpose = Option(meta?.purpose)
  const service = Option(meta?.service)

  const daysRemaining = expires.map((exp) => daysBetween(today, exp))

  const daysSinceCreated = created.map((c) => daysBetween(c, today))

  const isExpired = daysRemaining.fold(
    () => false,
    (d) => d < 0,
  )
  const isExpiringSoon = daysRemaining.fold(
    () => false,
    (d) => d >= 0 && d <= WARN_BEFORE_DAYS,
  )
  const isStale = daysSinceCreated.fold(
    () => false,
    (d) => d > staleWarningDays,
  )
  const isMissing = fnoxKeys.size > 0 && !fnoxKeys.has(key)

  const isMissingMetadata = (requireExpiration && expires.isNone()) || (requireService && service.isNone())

  if (isExpired) issues.push("Secret has expired")
  if (isExpiringSoon) {
    issues.push(
      `Expires in ${daysRemaining.fold(
        () => "?",
        (d) => String(d),
      )} days`,
    )
  }
  if (isStale) issues.push("Secret is stale (no rotation detected)")
  if (isMissing) issues.push("Key not found in fnox")
  if (isMissingMetadata) {
    if (requireExpiration && expires.isNone()) issues.push("Missing required expiration date")
    if (requireService && service.isNone()) issues.push("Missing required service")
  }

  const status: SecretStatus = Cond.of<SecretStatus>()
    .when(isExpired, "expired")
    .elseWhen(isMissing, "missing")
    .elseWhen(isMissingMetadata, "missing_metadata")
    .elseWhen(isExpiringSoon, "expiring_soon")
    .elseWhen(isStale, "stale")
    .else("healthy")

  return {
    key,
    service,
    status,
    days_remaining: daysRemaining,
    rotation_url: rotationUrl,
    purpose,
    created: Option(meta?.created),
    expires: Option(meta?.expires),
    issues: List(issues),
  }
}

export const computeAudit = (config: EnvpktConfig, fnoxKeys?: ReadonlySet<string>, today?: Date): AuditResult => {
  const now = today ?? new Date()
  const lifecycle = config.lifecycle ?? {}
  const staleWarningDays = lifecycle.stale_warning_days ?? 90
  const requireExpiration = lifecycle.require_expiration ?? false
  const requireService = lifecycle.require_service ?? false

  const keys = fnoxKeys ?? new Set<string>()
  const metaKeys = new Set(Object.keys(config.meta))

  const secrets = List(
    Object.entries(config.meta).map(([key, meta]) =>
      classifySecret(key, meta, keys, staleWarningDays, requireExpiration, requireService, now),
    ),
  )

  // Count orphaned: meta entries that don't have a corresponding fnox key
  // Only count when fnox keys are available
  const orphaned = keys.size > 0 ? [...metaKeys].filter((k) => !keys.has(k)).length : 0

  const total = secrets.size
  const expired = secrets.count((s) => s.status === "expired")
  const missing = secrets.count((s) => s.status === "missing")
  const missing_metadata = secrets.count((s) => s.status === "missing_metadata")
  const expiring_soon = secrets.count((s) => s.status === "expiring_soon")
  const stale = secrets.count((s) => s.status === "stale")
  const healthy = secrets.count((s) => s.status === "healthy")

  const status: HealthStatus = Cond.of<HealthStatus>()
    .when(expired > 0 || missing > 0, "critical")
    .elseWhen(expiring_soon > 0 || stale > 0 || missing_metadata > 0, "degraded")
    .else("healthy")

  return {
    status,
    secrets,
    total,
    healthy,
    expiring_soon,
    expired,
    stale,
    missing,
    missing_metadata,
    orphaned,
    agent: config.agent,
  }
}
