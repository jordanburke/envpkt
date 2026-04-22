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
  return agentSecrets.reduce<Either<CatalogError, Record<string, SecretMeta>>>(
    (acc, key) =>
      acc.flatMap((resolved) => {
        const catalogEntry = catalogMeta[key]
        if (catalogEntry === undefined) {
          return Left({ _tag: "SecretNotInCatalog", key, catalogPath })
        }
        const agentOverride = agentMeta[key]
        return Right({
          ...resolved,
          [key]: agentOverride !== undefined ? { ...catalogEntry, ...agentOverride } : catalogEntry,
        })
      }),
    Right({}),
  )
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

  if (!agentConfig.identity?.secrets || agentConfig.identity.secrets.length === 0) {
    return Left({
      _tag: "MissingSecretsList",
      message: "Config has 'catalog' but identity.secrets is missing — declare which catalog secrets this agent needs",
    })
  }

  const catalogPath = resolve(agentConfigDir, agentConfig.catalog)
  const agentSecrets = agentConfig.identity.secrets

  const agentSecretEntries = agentConfig.secret ?? {}

  return loadCatalog(catalogPath).flatMap((catalogConfig) =>
    resolveSecrets(agentSecretEntries, catalogConfig.secret ?? {}, agentSecrets, catalogPath).map((resolvedMeta) => {
      const merged = [...agentSecrets]
      const overridden = agentSecrets.filter((key) => key in agentSecretEntries)
      const warnings: string[] = []

      const { catalog: _catalog, ...agentWithoutCatalog } = agentConfig
      const identityData = agentConfig.identity
        ? (() => {
            const { secrets: _secrets, ...rest } = agentConfig.identity!
            return rest
          })()
        : undefined

      const resolvedConfig: EnvpktConfig = {
        ...agentWithoutCatalog,
        identity: identityData ? { ...identityData, name: identityData.name } : undefined,
        secret: resolvedMeta,
      }

      return {
        config: resolvedConfig,
        catalogPath,
        merged,
        overridden,
        warnings,
      }
    }),
  )
}
