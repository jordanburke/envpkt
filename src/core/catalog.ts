import { resolve } from "node:path"

import { type Either, Left, Right } from "functype"

import { loadConfig } from "./config.js"
import type { CatalogError, EnvpktConfig, ResolveResult, SecretMeta } from "./types.js"

/** Load and validate a catalog file, mapping ConfigError → CatalogError */
export const loadCatalog = (catalogPath: string): Either<CatalogError, EnvpktConfig> =>
  loadConfig(catalogPath).fold<Either<CatalogError, EnvpktConfig>>(
    (err) => {
      if (err._tag === "FileNotFound") {
        return Left({ _tag: "CatalogNotFound", path: err.path })
      }
      return Left({ _tag: "CatalogLoadError", message: `${err._tag}: ${"message" in err ? err.message : String(err)}` })
    },
    (config) => Right(config),
  )

/** Resolve secrets by merging catalog meta with agent overrides (shallow merge) */
export const resolveSecrets = (
  agentMeta: Record<string, SecretMeta>,
  catalogMeta: Record<string, SecretMeta>,
  agentSecrets: ReadonlyArray<string>,
  catalogPath: string,
): Either<CatalogError, Record<string, SecretMeta>> => {
  const resolved: Record<string, SecretMeta> = {}

  for (const key of agentSecrets) {
    const catalogEntry = catalogMeta[key]
    if (!catalogEntry) {
      return Left({ _tag: "SecretNotInCatalog", key, catalogPath })
    }
    const agentOverride = agentMeta[key]
    if (agentOverride) {
      resolved[key] = { ...catalogEntry, ...agentOverride }
    } else {
      resolved[key] = catalogEntry
    }
  }

  return Right(resolved)
}

/** Resolve an agent config against its catalog (if any), producing a flat self-contained config */
export const resolveConfig = (
  agentConfig: EnvpktConfig,
  agentConfigDir: string,
): Either<CatalogError, ResolveResult> => {
  if (!agentConfig.catalog) {
    const result: ResolveResult = {
      config: agentConfig,
      merged: [],
      overridden: [],
      warnings: [],
    }
    return Right(result)
  }

  if (!agentConfig.agent?.secrets || agentConfig.agent.secrets.length === 0) {
    return Left({
      _tag: "MissingSecretsList",
      message: "Config has 'catalog' but agent.secrets is missing — declare which catalog secrets this agent needs",
    })
  }

  const catalogPath = resolve(agentConfigDir, agentConfig.catalog)
  const agentSecrets = agentConfig.agent.secrets

  return loadCatalog(catalogPath).flatMap<ResolveResult>((catalogConfig) =>
    resolveSecrets(agentConfig.meta, catalogConfig.meta, agentSecrets, catalogPath).map<ResolveResult>(
      (resolvedMeta) => {
        const merged: string[] = []
        const overridden: string[] = []
        const warnings: string[] = []

        for (const key of agentSecrets) {
          merged.push(key)
          if (agentConfig.meta[key]) {
            overridden.push(key)
          }
        }

        const { catalog: _catalog, ...agentWithoutCatalog } = agentConfig
        const agentIdentity = agentConfig.agent
          ? (() => {
              const { secrets: _secrets, ...rest } = agentConfig.agent!
              return rest
            })()
          : undefined

        const resolvedConfig: EnvpktConfig = {
          ...agentWithoutCatalog,
          agent: agentIdentity ? { ...agentIdentity, name: agentIdentity.name } : undefined,
          meta: resolvedMeta,
        }

        return {
          config: resolvedConfig,
          catalogPath,
          merged,
          overridden,
          warnings,
        }
      },
    ),
  )
}
