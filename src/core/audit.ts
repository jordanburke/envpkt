import { Cond, List, Option } from "functype"

import type { EnvpktConfig } from "./schema.js"
import type {
  AliasTable,
  AuditResult,
  EnvAuditResult,
  EnvDriftStatus,
  HealthStatus,
  SecretHealth,
  SecretStatus,
} from "./types.js"

const MS_PER_DAY = 86_400_000
const WARN_BEFORE_DAYS = 30

const daysBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)

const parseDate = (dateStr: string): Option<Date> => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? Option<Date>(undefined) : Option(d)
}

const classifySecret = (
  key: string,
  meta: NonNullable<EnvpktConfig["secret"]>[string],
  fnoxKeys: ReadonlySet<string>,
  staleWarningDays: number,
  requireExpiration: boolean,
  requireService: boolean,
  today: Date,
): SecretHealth => {
  const issues: string[] = []

  const created = Option(meta.created).flatMap(parseDate)
  const expires = Option(meta.expires).flatMap(parseDate)
  const rotationUrl = Option(meta.rotation_url)
  const purpose = Option(meta.purpose)
  const service = Option(meta.service)

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
  const hasSealed = !!meta.encrypted_value
  const isMissing = fnoxKeys.size > 0 && !fnoxKeys.has(key) && !hasSealed

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
    created: Option(meta.created),
    expires: Option(meta.expires),
    issues: List(issues),
    alias_of: Option<string>(undefined),
  }
}

/**
 * Build a SecretHealth row for an alias entry. Status is inherited from the
 * target; metadata (purpose, tags) comes from the alias entry itself where
 * set, otherwise falls through to the target so operators see context.
 */
const classifyAlias = (
  key: string,
  meta: NonNullable<EnvpktConfig["secret"]>[string],
  targetHealth: SecretHealth,
  targetRef: string,
): SecretHealth => ({
  key,
  service: targetHealth.service,
  status: targetHealth.status,
  days_remaining: targetHealth.days_remaining,
  rotation_url: targetHealth.rotation_url,
  purpose: meta.purpose !== undefined ? Option(meta.purpose) : targetHealth.purpose,
  created: targetHealth.created,
  expires: targetHealth.expires,
  issues: List<string>([]),
  alias_of: Option(targetRef),
})

export const computeAudit = (
  config: EnvpktConfig,
  fnoxKeys?: ReadonlySet<string>,
  today?: Date,
  aliasTable?: AliasTable,
): AuditResult => {
  const now = today ?? new Date()
  const lifecycle = config.lifecycle ?? {}
  const staleWarningDays = lifecycle.stale_warning_days ?? 90
  const requireExpiration = lifecycle.require_expiration ?? false
  const requireService = lifecycle.require_service ?? false

  const keys = fnoxKeys ?? new Set<string>()
  const secretEntries = config.secret ?? {}

  // Non-alias entries: classify normally
  const nonAliasEntries = Object.entries(secretEntries).filter(([, meta]) => meta.from_key === undefined)
  const aliasEntries = Object.entries(secretEntries).filter(([, meta]) => meta.from_key !== undefined)
  const nonAliasMetaKeys = new Set(nonAliasEntries.map(([k]) => k))

  const nonAliasHealth = nonAliasEntries.map(([key, meta]) =>
    classifySecret(key, meta, keys, staleWarningDays, requireExpiration, requireService, now),
  )
  const healthByKey = new Map(nonAliasHealth.map((h) => [h.key, h]))

  // Alias entries: inherit status from target
  const aliasHealth = aliasEntries.map(([key, meta]) => {
    const tableEntry = aliasTable?.entries.get(`secret.${key}`)
    const targetKey = tableEntry?.targetKey
    const targetHealth = targetKey !== undefined ? healthByKey.get(targetKey) : undefined
    const targetRef = meta.from_key ?? (targetKey !== undefined ? `secret.${targetKey}` : "")
    if (!targetHealth) {
      // Target missing — shouldn't happen if validator ran, but be defensive
      return {
        key,
        service: Option(meta.service),
        status: "missing" as SecretStatus,
        days_remaining: Option<number>(undefined),
        rotation_url: Option(meta.rotation_url),
        purpose: Option(meta.purpose),
        created: Option(meta.created),
        expires: Option(meta.expires),
        issues: List<string>(["Alias target not resolvable"]),
        alias_of: Option(targetRef),
      }
    }
    return classifyAlias(key, meta, targetHealth, targetRef)
  })

  const secrets = List([...nonAliasHealth, ...aliasHealth])

  // Count orphaned: non-alias secret entries that don't have a corresponding fnox key
  // Only count when fnox keys are available
  const orphaned = keys.size > 0 ? [...nonAliasMetaKeys].filter((k) => !keys.has(k)).length : 0

  const total = secrets.size
  const expired = secrets.count((s) => s.status === "expired")
  const missing = secrets.count((s) => s.status === "missing")
  const missing_metadata = secrets.count((s) => s.status === "missing_metadata")
  const expiring_soon = secrets.count((s) => s.status === "expiring_soon")
  const stale = secrets.count((s) => s.status === "stale")
  const healthy = secrets.count((s) => s.status === "healthy")
  const aliases = aliasHealth.length

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
    aliases,
    identity: config.identity,
  }
}

export const computeEnvAudit = (
  config: EnvpktConfig,
  // eslint-disable-next-line functype/prefer-option -- process.env uses string | undefined natively
  env: Readonly<Record<string, string | undefined>> = process.env,
): EnvAuditResult => {
  const envEntries = config.env ?? {}

  const entries = Object.entries(envEntries).map(([key, entry]) => {
    const currentValue = env[key]
    // Resolve effective default: for aliases, it's the target's value
    const effectiveDefault =
      entry.from_key !== undefined
        ? (() => {
            const match = /^env\.(.+)$/.exec(entry.from_key)
            const targetKey = match?.[1]
            const targetEntry = targetKey !== undefined ? envEntries[targetKey] : undefined
            return targetEntry?.value ?? ""
          })()
        : (entry.value ?? "")

    const status: EnvDriftStatus = Cond.of<EnvDriftStatus>()
      .when(currentValue === undefined, "missing")
      .elseWhen(currentValue !== effectiveDefault, "overridden")
      .else("default")

    return {
      key,
      defaultValue: effectiveDefault,
      currentValue,
      status,
      purpose: entry.purpose,
      alias_of: Option(entry.from_key),
    }
  })

  return {
    entries,
    total: entries.length,
    defaults_applied: entries.filter((e) => e.status === "default").length,
    overridden: entries.filter((e) => e.status === "overridden").length,
    missing: entries.filter((e) => e.status === "missing").length,
  }
}
