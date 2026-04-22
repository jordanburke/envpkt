import { List, Option, Set as FSet } from "functype"

import type { ConfidenceLevel, MatchResult } from "./patterns.js"
import { scanEnv } from "./patterns.js"
import type { EnvpktConfig } from "./types.js"

// --- Types ---

export type ScanResult = {
  readonly discovered: List<MatchResult>
  readonly total_scanned: number
  readonly high_confidence: number
  readonly medium_confidence: number
  readonly low_confidence: number
}

export type DriftStatus = "tracked" | "missing_from_env" | "untracked"

export type DriftEntry = {
  readonly envVar: string
  readonly service: Option<string>
  readonly status: DriftStatus
  readonly confidence: Option<ConfidenceLevel>
}

export type CheckResult = {
  readonly entries: List<DriftEntry>
  readonly tracked_and_present: number
  readonly missing_from_env: number
  readonly untracked_credentials: number
  readonly is_clean: boolean
}

export type ScanOptions = {
  readonly includeUnknown?: boolean
}

// --- Core functions ---

/** Scan env for credentials, returning structured results */
// eslint-disable-next-line functype/prefer-option -- process.env uses string | undefined natively
export const envScan = (env: Readonly<Record<string, string | undefined>>, options?: ScanOptions): ScanResult => {
  const allMatches = scanEnv(env)

  const discovered = options?.includeUnknown ? allMatches : allMatches.filter((m) => m.service.isSome())

  const total_scanned = Object.keys(env).length
  const high_confidence = discovered.filter((m) => m.confidence === "high").length
  const medium_confidence = discovered.filter((m) => m.confidence === "medium").length
  const low_confidence = discovered.filter((m) => m.confidence === "low").length

  return {
    discovered: List(discovered),
    total_scanned,
    high_confidence,
    medium_confidence,
    low_confidence,
  }
}

const parseAliasRef = (raw: string, expectedKind: "secret" | "env"): Option<string> => {
  const match = raw.match(/^(secret|env)\.(.+)$/)
  if (match?.[1] !== expectedKind) return Option<string>(undefined)
  return Option(match[2])
}

/** Bidirectional drift detection between config and live environment */
// eslint-disable-next-line functype/prefer-option -- process.env uses string | undefined natively
export const envCheck = (config: EnvpktConfig, env: Readonly<Record<string, string | undefined>>): CheckResult => {
  const secretEntries = config.secret ?? {}
  const metaKeys = Object.keys(secretEntries)
  const metaKeysSet = FSet(metaKeys)

  // A secret entry is "satisfied" if its canonical name is set, OR (for aliases)
  // its target name is set — because at boot the alias will copy from target.
  const isSecretPresent = (key: string): boolean => {
    if (env[key] !== undefined && env[key] !== "") return true
    const meta = secretEntries[key]
    if (meta?.from_key === undefined) return false
    return parseAliasRef(meta.from_key, "secret").fold(
      () => false,
      (targetKey) => env[targetKey] !== undefined && env[targetKey] !== "",
    )
  }

  // Direction 1: TOML keys → check if present in env (aliases satisfied by target)
  const secretDriftEntries: DriftEntry[] = Object.entries(secretEntries).map(([key, meta]) => {
    const present = isSecretPresent(key)
    return {
      envVar: key,
      service: Option(meta.service),
      status: (present ? "tracked" : "missing_from_env") as DriftStatus,
      confidence: Option<ConfidenceLevel>(undefined),
    }
  })

  // Direction 1b: [env.*] keys → check if present (non-secret defaults; aliases satisfied by target)
  const envDefaults = config.env ?? {}
  const isEnvPresent = (key: string): boolean => {
    if (env[key] !== undefined && env[key] !== "") return true
    const meta = envDefaults[key]
    if (meta?.from_key === undefined) return false
    return parseAliasRef(meta.from_key, "env").fold(
      () => false,
      (targetKey) => env[targetKey] !== undefined && env[targetKey] !== "",
    )
  }

  // Env defaults excluding any key already tracked as a secret
  const envDefaultEntries: DriftEntry[] = Object.keys(envDefaults)
    .filter((key) => !metaKeysSet.has(key))
    .map((key) => {
      const present = isEnvPresent(key)
      return {
        envVar: key,
        service: Option<string>(undefined),
        status: (present ? "tracked" : "missing_from_env") as DriftStatus,
        confidence: Option<ConfidenceLevel>(undefined),
      }
    })

  // Keys considered "tracked" = secrets ∪ env defaults (after dedup above)
  const trackedKeys = FSet([...metaKeys, ...envDefaultEntries.map((e) => e.envVar)])

  // Direction 2: env vars → find credential-shaped vars not in TOML
  const envMatches = scanEnv(env)
  const untrackedEntries: DriftEntry[] = envMatches
    .filter((match) => !trackedKeys.has(match.envVar))
    .map((match) => ({
      envVar: match.envVar,
      service: match.service,
      status: "untracked" as DriftStatus,
      confidence: Option(match.confidence),
    }))

  const entries = [...secretDriftEntries, ...envDefaultEntries, ...untrackedEntries]

  const tracked_and_present = entries.filter((e) => e.status === "tracked").length
  const missing_from_env = entries.filter((e) => e.status === "missing_from_env").length
  const untracked_credentials = entries.filter((e) => e.status === "untracked").length

  return {
    entries: List(entries),
    tracked_and_present,
    missing_from_env,
    untracked_credentials,
    is_clean: missing_from_env === 0 && untracked_credentials === 0,
  }
}

const todayIso = (): string => new Date().toISOString().split("T")[0]!

/** Generate TOML [secret.*] blocks from scan results, mirroring init.ts pattern */
export const generateTomlFromScan = (matches: ReadonlyArray<MatchResult>): string => {
  const blocks = matches.map((match) => {
    const svc = match.service.fold(
      () => match.envVar.toLowerCase().replace(/_/g, "-"),
      (s) => s,
    )
    return `[secret.${match.envVar}]
service = "${svc}"
# purpose = ""               # Why: what this secret enables
# capabilities = []          # What operations this grants
created = "${todayIso()}"
# expires = ""               # When: YYYY-MM-DD expiration date
# rotation_url = ""          # URL for rotation procedure
# source = ""                # Where the value originates (e.g. vault, ci)
# tags = {}
`
  })

  return blocks.join("\n")
}
