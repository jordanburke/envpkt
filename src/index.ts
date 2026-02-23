// Schema definitions (TypeBox)
export {
  AgentIdentitySchema,
  CallbackConfigSchema,
  ConsumerType,
  EnvpktConfigSchema,
  LifecycleConfigSchema,
  SecretMetaSchema,
  ToolsConfigSchema,
} from "./core/schema.js"

// TypeScript types (Static<> from schema + domain types)
export type {
  AgentIdentity,
  AuditResult,
  CallbackConfig,
  ConfigError,
  EnvpktConfig,
  FleetAgent,
  FleetHealth,
  FnoxConfig,
  FnoxError,
  FnoxSecret,
  HealthStatus,
  LifecycleConfig,
  SecretHealth,
  SecretMeta,
  SecretStatus,
  ToolsConfig,
} from "./core/types.js"

// Config operations
export {
  findConfigPath,
  loadConfig,
  loadConfigFromCwd,
  parseToml,
  readConfigFile,
  resolveConfigPath,
  validateConfig,
} from "./core/config.js"

// Audit engine
export { computeAudit } from "./core/audit.js"

// Fleet scanner
export { scanFleet } from "./core/fleet.js"

// fnox integration
export { fnoxExport, fnoxGet } from "./fnox/cli.js"
export { detectFnox, fnoxAvailable } from "./fnox/detect.js"
export { extractFnoxKeys, readFnoxConfig } from "./fnox/parse.js"
export { compareFnoxAndEnvpkt } from "./fnox/sync.js"

// MCP server
export { readResource, resourceDefinitions } from "./mcp/resources.js"
export { createServer, startServer } from "./mcp/server.js"
export { callTool, toolDefinitions } from "./mcp/tools.js"
