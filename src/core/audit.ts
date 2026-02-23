import { Cond, List, Option } from "functype"

import type { EnvpktConfig } from "./schema.js"
import type { AuditResult, HealthStatus, SecretHealth, SecretStatus } from "./types.js"

const MS_PER_DAY = 86_400_000

const daysBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)

const parseDate = (dateStr: string): Option<Date> => {
  const d = new Date(dateStr + "T00:00:00Z")
  return Number.isNaN(d.getTime()) ? Option<Date>(undefined) : Option(d)
}

const classifySecret = (
  key: string,
  meta: EnvpktConfig["meta"][string],
  fnoxKeys: ReadonlySet<string>,
  warnBeforeDays: number,
  staleAfterDays: number,
  requireRotationUrl: boolean,
  requirePurpose: boolean,
  today: Date,
): SecretHealth => {
  const issues: string[] = []

  const created = Option(meta?.created).flatMap(parseDate)
  const expires = Option(meta?.expires).flatMap(parseDate)
  const rotationUrl = Option(meta?.rotation_url)
  const purpose = Option(meta?.purpose)

  const daysRemaining = expires.map((exp) => daysBetween(today, exp))

  const daysSinceCreated = created.map((c) => daysBetween(c, today))

  const isExpired = daysRemaining.fold(
    () => false,
    (d) => d < 0,
  )
  const isExpiringSoon = daysRemaining.fold(
    () => false,
    (d) => d >= 0 && d <= warnBeforeDays,
  )
  const isStale = daysSinceCreated.fold(
    () => false,
    (d) => d > staleAfterDays,
  )
  const isMissing = fnoxKeys.size > 0 && !fnoxKeys.has(key)

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
  if (requireRotationUrl && rotationUrl.isNone()) issues.push("Missing required rotation_url")
  if (requirePurpose && purpose.isNone()) issues.push("Missing required purpose")

  const status: SecretStatus = Cond.of<SecretStatus>()
    .when(isExpired, "expired")
    .elseWhen(isMissing, "missing")
    .elseWhen(isExpiringSoon, "expiring_soon")
    .elseWhen(isStale, "stale")
    .else("healthy")

  return {
    key,
    service: meta?.service ?? key,
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
  const warnBeforeDays = lifecycle.warn_before_days ?? 30
  const staleAfterDays = lifecycle.stale_after_days ?? 365
  const requireRotationUrl = lifecycle.require_rotation_url ?? false
  const requirePurpose = lifecycle.require_purpose ?? false

  const keys = fnoxKeys ?? new Set<string>()

  const secrets = List(
    Object.entries(config.meta).map(([key, meta]) =>
      classifySecret(key, meta, keys, warnBeforeDays, staleAfterDays, requireRotationUrl, requirePurpose, now),
    ),
  )

  const total = secrets.size
  const expired = secrets.count((s) => s.status === "expired")
  const missing = secrets.count((s) => s.status === "missing")
  const expiring_soon = secrets.count((s) => s.status === "expiring_soon")
  const stale = secrets.count((s) => s.status === "stale")
  const healthy = secrets.count((s) => s.status === "healthy")

  const status: HealthStatus = Cond.of<HealthStatus>()
    .when(expired > 0 || missing > 0, "critical")
    .elseWhen(expiring_soon > 0 || stale > 0, "degraded")
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
  }
}
