import { Option } from "functype"

import type { Identity, LifecycleConfig, ResolveResult, SecretMeta } from "./types.js"

export type SecretDisplay = "encrypted" | "plaintext"

export type FormatPacketOptions = {
  readonly secrets?: Readonly<Record<string, string>>
  readonly secretDisplay?: SecretDisplay
}

export const maskValue = (value: string): string => {
  if (value.length > 8) {
    return `${value.slice(0, 3)}${"•".repeat(5)}${value.slice(-4)}`
  }
  return "•".repeat(5)
}

const formatSecretFields = (meta: SecretMeta, indent: string): string => {
  const dateLine: ReadonlyArray<string> = [
    ...(meta.created ? [`created: ${meta.created}`] : []),
    ...(meta.expires ? [`expires: ${meta.expires}`] : []),
  ]
  const opsLine: ReadonlyArray<string> = [
    ...(meta.rotates ? [`rotates: ${meta.rotates}`] : []),
    ...(meta.rate_limit ? [`rate_limit: ${meta.rate_limit}`] : []),
  ]
  const tags = meta.tags
    ? [
        `${indent}tags: ${Object.entries(meta.tags)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
      ]
    : []

  const lines: ReadonlyArray<string> = [
    ...(meta.purpose ? [`${indent}purpose: ${meta.purpose}`] : []),
    ...(meta.capabilities ? [`${indent}capabilities: ${meta.capabilities.join(", ")}`] : []),
    ...(dateLine.length > 0 ? [`${indent}${dateLine.join("  ")}`] : []),
    ...(opsLine.length > 0 ? [`${indent}${opsLine.join("  ")}`] : []),
    ...(meta.source ? [`${indent}source: ${meta.source}`] : []),
    ...(meta.model_hint ? [`${indent}model_hint: ${meta.model_hint}`] : []),
    ...(meta.rotation_url ? [`${indent}rotation_url: ${meta.rotation_url}`] : []),
    ...(meta.required !== undefined ? [`${indent}required: ${meta.required}`] : []),
    ...tags,
  ]

  return lines.join("\n")
}

const formatHeader = (identity: Identity | undefined): string => {
  if (!identity) return "envpkt packet"
  const consumer = identity.consumer ? ` (${identity.consumer})` : ""
  return `envpkt packet: ${identity.name}${consumer}`
}

const formatAgentBlock = (identity: Identity | undefined): ReadonlyArray<string> => {
  if (!identity) return []
  const agentLines: ReadonlyArray<string> = [
    ...(identity.description ? [`  ${identity.description}`] : []),
    ...(identity.capabilities ? [`  capabilities: ${identity.capabilities.join(", ")}`] : []),
    ...(identity.services ? [`  services: ${identity.services.join(", ")}`] : []),
    ...(identity.expires ? [`  expires: ${identity.expires}`] : []),
  ]
  return agentLines.length > 0 ? [agentLines.join("\n")] : []
}

const formatLifecycleBlock = (lifecycle: LifecycleConfig | undefined): ReadonlyArray<string> => {
  if (!lifecycle) return []
  const lcLines: ReadonlyArray<string> = [
    ...(lifecycle.stale_warning_days !== undefined ? [`  stale_warning_days: ${lifecycle.stale_warning_days}`] : []),
    ...(lifecycle.require_expiration !== undefined ? [`  require_expiration: ${lifecycle.require_expiration}`] : []),
    ...(lifecycle.require_service !== undefined ? [`  require_service: ${lifecycle.require_service}`] : []),
  ]
  return lcLines.length > 0 ? [["lifecycle:", ...lcLines].join("\n")] : []
}

const formatCatalogBlock = (result: ResolveResult): ReadonlyArray<string> => {
  if (!result.catalogPath) return []
  const catLines: ReadonlyArray<string> = [
    `catalog: ${result.catalogPath}`,
    `  merged: ${result.merged.length} keys`,
    result.overridden.length > 0 ? `  overridden: ${result.overridden.join(", ")}` : "  overridden: (none)",
    ...result.warnings.map((w) => `  warning: ${w}`),
  ]
  return [catLines.join("\n")]
}

export const formatPacket = (result: ResolveResult, options?: FormatPacketOptions): string => {
  const { config } = result

  // Secrets block
  const secretConfig = config.secret ?? {}
  const metaEntries = Object.entries(secretConfig)
  const secretHeader = `secrets: ${metaEntries.length}`
  const secretLines = metaEntries.map(([key, meta]) => {
    const service = meta.service ?? key
    const sealedTag = meta.encrypted_value ? " [sealed]" : ""
    const aliasTag = meta.from_key ? ` [alias → ${meta.from_key}]` : ""
    const valueSuffix = Option(options?.secrets?.[key]).fold(
      () => "",
      (secretValue) =>
        ` = ${(options?.secretDisplay ?? "encrypted") === "plaintext" ? secretValue : maskValue(secretValue)}`,
    )
    const header = `  ${key} → ${service}${sealedTag}${aliasTag}${valueSuffix}`
    const fields = formatSecretFields(meta, "    ")
    return fields ? `${header}\n${fields}` : header
  })

  // Env block — show alias relationships
  const envConfig = config.env ?? {}
  const envEntriesArr = Object.entries(envConfig)
  const envBlock: ReadonlyArray<string> =
    envEntriesArr.length > 0
      ? [
          [
            `env: ${envEntriesArr.length}`,
            ...envEntriesArr.map(([key, meta]) => {
              const aliasTag = meta.from_key ? ` [alias → ${meta.from_key}]` : ""
              const valuePart = Option(meta.value).fold(
                () => "",
                (v) => ` = ${v}`,
              )
              const purposePart = meta.purpose ? `\n    purpose: ${meta.purpose}` : ""
              return `  ${key}${aliasTag}${valuePart}${purposePart}`
            }),
          ].join("\n"),
        ]
      : []

  const sections: ReadonlyArray<string> = [
    formatHeader(config.identity),
    ...formatAgentBlock(config.identity),
    [secretHeader, ...secretLines].join("\n"),
    ...envBlock,
    ...formatLifecycleBlock(config.lifecycle),
    ...formatCatalogBlock(result),
  ]

  return sections.join("\n\n")
}
