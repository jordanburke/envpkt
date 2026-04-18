// Schema definitions (TypeBox)
export {
  AgentIdentitySchema,
  CallbackConfigSchema,
  ConsumerType,
  EnvMetaSchema,
  EnvpktConfigSchema,
  IdentitySchema,
  LifecycleConfigSchema,
  SecretMetaSchema,
  ToolsConfigSchema,
} from "./core/schema.js"

// TypeScript types (Static<> from schema + domain types)
export type {
  AgentIdentity,
  AliasError,
  AliasTable,
  AuditResult,
  BootError,
  BootOptions,
  BootResult,
  CallbackConfig,
  CatalogError,
  ConfigError,
  ConfigSource,
  EnvAuditResult,
  EnvDriftEntry,
  EnvDriftStatus,
  EnvMeta,
  EnvpktConfig,
  FleetAgent,
  FleetHealth,
  FnoxConfig,
  FnoxError,
  FnoxSecret,
  HealthStatus,
  Identity,
  IdentityError,
  KeygenError,
  KeygenResult,
  LifecycleConfig,
  ResolvedPath,
  ResolveOptions,
  ResolveResult,
  SealError,
  SecretHealth,
  SecretMeta,
  SecretStatus,
  TomlEditError,
  ToolsConfig,
} from "./core/types.js"

// Config operations
export {
  discoverConfig,
  findConfigPath,
  loadConfig,
  loadConfigFromCwd,
  parseToml,
  readConfigFile,
  resolveConfigPath,
  validateConfig,
} from "./core/config.js"

// Catalog resolution
export { loadCatalog, resolveConfig, resolveSecrets } from "./core/catalog.js"

// Alias validation
export { formatAliasError, isEnvAlias, isSecretAlias, validateAliases } from "./core/alias.js"

// Packet formatting
export type { FormatPacketOptions, SecretDisplay } from "./core/format.js"
export { formatPacket, maskValue } from "./core/format.js"

// Audit engine
export { computeAudit, computeEnvAudit } from "./core/audit.js"

// Pattern registry
export type { ConfidenceLevel, CredentialPattern, MatchResult } from "./core/patterns.js"
export { deriveServiceFromName, matchEnvVar, matchValueShape, scanEnv } from "./core/patterns.js"

// Env scan/check
export type { CheckResult, DriftEntry, DriftStatus, ScanOptions, ScanResult } from "./core/env.js"
export { envCheck, envScan, generateTomlFromScan } from "./core/env.js"

// Boot API
export { boot, bootSafe, EnvpktBootError } from "./core/boot.js"

// Diagnostic logger re-exports from functype-log. BootOptions.logger accepts
// any DirectLogger; consumers can use createDirectConsoleLogger for quick
// enabling, createDirectTestLogger for assertions, or bring their own.
export {
  createDirectConsoleLogger,
  createDirectTestLogger,
  type DirectLogger,
  directSilentLogger,
  type DirectTestLoggerHandle,
  type LogEntry,
  type LogLevel,
  type LogMetadata,
} from "functype-log"

// Seal API
export { ageDecrypt, ageEncrypt, sealSecrets, unsealSecrets } from "./core/seal.js"

// Keygen API
export { generateKeypair, resolveInlineKey, resolveKeyPath, updateConfigIdentity } from "./core/keygen.js"

// Value resolution
export { resolveValues } from "./core/resolve-values.js"

// TOML editing
export { appendSection, removeSection, renameSection, updateSectionFields } from "./core/toml-edit.js"

// Fleet scanner
export { scanFleet } from "./core/fleet.js"

// fnox integration
export { fnoxExport, fnoxGet } from "./fnox/cli.js"
export { detectFnox, fnoxAvailable } from "./fnox/detect.js"
export { ageAvailable, unwrapAgentKey } from "./fnox/identity.js"
export { extractFnoxKeys, readFnoxConfig } from "./fnox/parse.js"
export { compareFnoxAndEnvpkt } from "./fnox/sync.js"

// MCP server
export { readResource, resourceDefinitions } from "./mcp/resources.js"
export { createServer, startServer } from "./mcp/server.js"
export { callTool, toolDefinitions } from "./mcp/tools.js"
