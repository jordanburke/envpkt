import { dirname, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveConfig } from "../../src/core/catalog.js"
import { loadConfig } from "../../src/core/config.js"
import { apiGatewayResult, dataPipelineResult, monitoringResult } from "./demo-data.js"

const demoDir = resolve(dirname(new URL(import.meta.url).pathname), "../../examples/demo")

const loadAndResolve = (agentPath: string) => {
  const fullPath = resolve(demoDir, agentPath)
  const config = loadConfig(fullPath)
  return config.flatMap((c) => resolveConfig(c, dirname(fullPath)))
}

describe("demo fixture cross-check", () => {
  describe("api-gateway", () => {
    it("matches fixture structure", () => {
      const result = loadAndResolve("agents/api-gateway/envpkt.toml")

      result.fold(
        (err) => expect.fail(`Failed to resolve api-gateway: ${JSON.stringify(err)}`),
        (resolved) => {
          expect(resolved.config.identity?.name).toBe(apiGatewayResult.config.identity?.name)
          expect(resolved.config.identity?.consumer).toBe(apiGatewayResult.config.identity?.consumer)
          expect(Object.keys(resolved.config.secret).sort()).toEqual(Object.keys(apiGatewayResult.config.secret).sort())
          expect(resolved.overridden).toEqual([...apiGatewayResult.overridden])
          expect(resolved.merged.sort()).toEqual([...apiGatewayResult.merged].sort())
          expect(resolved.config.secret.DATABASE_URL.capabilities).toEqual(
            apiGatewayResult.config.secret.DATABASE_URL.capabilities,
          )
        },
      )
    })
  })

  describe("data-pipeline", () => {
    it("matches fixture structure", () => {
      const result = loadAndResolve("agents/data-pipeline/envpkt.toml")

      result.fold(
        (err) => expect.fail(`Failed to resolve data-pipeline: ${JSON.stringify(err)}`),
        (resolved) => {
          expect(resolved.config.identity?.name).toBe(dataPipelineResult.config.identity?.name)
          expect(resolved.config.identity?.consumer).toBe(dataPipelineResult.config.identity?.consumer)
          expect(Object.keys(resolved.config.secret).sort()).toEqual(
            Object.keys(dataPipelineResult.config.secret).sort(),
          )
          expect(resolved.overridden).toEqual([...dataPipelineResult.overridden])
          expect(resolved.merged.sort()).toEqual([...dataPipelineResult.merged].sort())
          // Verify capability narrowing: data-pipeline gets SELECT only
          expect(resolved.config.secret.DATABASE_URL.capabilities).toEqual(["SELECT"])
        },
      )
    })
  })

  describe("monitoring", () => {
    it("matches fixture structure", () => {
      const result = loadAndResolve("agents/monitoring/envpkt.toml")

      result.fold(
        (err) => expect.fail(`Failed to resolve monitoring: ${JSON.stringify(err)}`),
        (resolved) => {
          expect(resolved.config.identity?.name).toBe(monitoringResult.config.identity?.name)
          expect(resolved.config.identity?.consumer).toBe(monitoringResult.config.identity?.consumer)
          expect(Object.keys(resolved.config.secret).sort()).toEqual(Object.keys(monitoringResult.config.secret).sort())
          // Standalone — no catalog
          expect(resolved.catalogPath).toBeUndefined()
          expect(resolved.merged).toEqual([])
          expect(resolved.config.lifecycle?.stale_warning_days).toBe(
            monitoringResult.config.lifecycle?.stale_warning_days,
          )
        },
      )
    })
  })
})
