import type { ResolveResult, SecretMeta } from "./types.js"

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
  const lines: string[] = []

  if (meta.purpose) lines.push(`${indent}purpose: ${meta.purpose}`)
  if (meta.capabilities) lines.push(`${indent}capabilities: ${meta.capabilities.join(", ")}`)

  const dateLine: string[] = []
  if (meta.created) dateLine.push(`created: ${meta.created}`)
  if (meta.expires) dateLine.push(`expires: ${meta.expires}`)
  if (dateLine.length > 0) lines.push(`${indent}${dateLine.join("  ")}`)

  const opsLine: string[] = []
  if (meta.rotates) opsLine.push(`rotates: ${meta.rotates}`)
  if (meta.rate_limit) opsLine.push(`rate_limit: ${meta.rate_limit}`)
  if (opsLine.length > 0) lines.push(`${indent}${opsLine.join("  ")}`)

  if (meta.source) lines.push(`${indent}source: ${meta.source}`)
  if (meta.model_hint) lines.push(`${indent}model_hint: ${meta.model_hint}`)
  if (meta.rotation_url) lines.push(`${indent}rotation_url: ${meta.rotation_url}`)
  if (meta.required !== undefined) lines.push(`${indent}required: ${meta.required}`)
  if (meta.tags) {
    const tagStr = Object.entries(meta.tags)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")
    lines.push(`${indent}tags: ${tagStr}`)
  }

  return lines.join("\n")
}

export const formatPacket = (result: ResolveResult, options?: FormatPacketOptions): string => {
  const { config } = result
  const sections: string[] = []

  // Header
  if (config.agent) {
    const consumer = config.agent.consumer ? ` (${config.agent.consumer})` : ""
    sections.push(`envpkt packet: ${config.agent.name}${consumer}`)
  } else {
    sections.push("envpkt packet")
  }

  // Agent block
  if (config.agent) {
    const agentLines: string[] = []
    if (config.agent.description) agentLines.push(`  ${config.agent.description}`)
    if (config.agent.capabilities) agentLines.push(`  capabilities: ${config.agent.capabilities.join(", ")}`)
    if (config.agent.services) agentLines.push(`  services: ${config.agent.services.join(", ")}`)
    if (config.agent.expires) agentLines.push(`  expires: ${config.agent.expires}`)
    if (agentLines.length > 0) sections.push(agentLines.join("\n"))
  }

  // Secrets block
  const metaEntries = Object.entries(config.meta)
  const secretHeader = `secrets: ${metaEntries.length}`
  const secretLines = metaEntries.map(([key, meta]) => {
    const service = meta.service ?? key
    const secretValue = options?.secrets?.[key]
    const valueSuffix =
      secretValue !== undefined
        ? ` = ${(options?.secretDisplay ?? "encrypted") === "plaintext" ? secretValue : maskValue(secretValue)}`
        : ""
    const header = `  ${key} → ${service}${valueSuffix}`
    const fields = formatSecretFields(meta, "    ")
    return fields ? `${header}\n${fields}` : header
  })
  sections.push([secretHeader, ...secretLines].join("\n"))

  // Lifecycle block
  if (config.lifecycle) {
    const lcLines: string[] = ["lifecycle:"]
    if (config.lifecycle.stale_warning_days !== undefined)
      lcLines.push(`  stale_warning_days: ${config.lifecycle.stale_warning_days}`)
    if (config.lifecycle.require_expiration !== undefined)
      lcLines.push(`  require_expiration: ${config.lifecycle.require_expiration}`)
    if (config.lifecycle.require_service !== undefined)
      lcLines.push(`  require_service: ${config.lifecycle.require_service}`)
    if (lcLines.length > 1) sections.push(lcLines.join("\n"))
  }

  // Catalog block
  if (result.catalogPath) {
    const catLines: string[] = [`catalog: ${result.catalogPath}`]
    catLines.push(`  merged: ${result.merged.length} keys`)
    if (result.overridden.length > 0) {
      catLines.push(`  overridden: ${result.overridden.join(", ")}`)
    } else {
      catLines.push("  overridden: (none)")
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        catLines.push(`  warning: ${w}`)
      }
    }
    sections.push(catLines.join("\n"))
  }

  return sections.join("\n\n")
}
