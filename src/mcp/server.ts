import { createServer as createSomaServer, type SomaServerInstance } from "somamcp/node"

import { packageVersion } from "../core/version.js"
import { readResource, resourceDefinitions } from "./resources.js"
import { callTool, toolDefinitions } from "./tools.js"
import { typeboxStandardSchema } from "./typebox-schema.js"

const INSTRUCTIONS =
  "envpkt provides credential lifecycle awareness for AI agents. Use tools to check health, capabilities, and secret metadata. No secret values are ever exposed."

/**
 * The envpkt MCP server, built on somamcp. Every tool and resource reads `envpkt.toml`
 * metadata only, so all of them are read-only and none returns a secret value.
 */
export const createServer = (): SomaServerInstance => {
  const server = createSomaServer({
    name: "envpkt",
    version: packageVersion() as `${number}.${number}.${number}`,
    instructions: INSTRUCTIONS,
  })

  toolDefinitions.forEach((def) => {
    server.addTool({
      name: def.name,
      description: def.description,
      parameters: typeboxStandardSchema(def.parameters),
      annotations: { readOnlyHint: true, openWorldHint: false },
      execute: (args) => Promise.resolve(callTool(def.name, args as Record<string, unknown>)),
    })
  })

  resourceDefinitions.forEach((def) => {
    server.addResource({
      ...def,
      load: () =>
        Promise.resolve(
          readResource(def.uri).fold(
            () => [{ uri: def.uri, mimeType: "text/plain", text: `Resource not found: ${def.uri}` }],
            (result) => result.contents,
          ),
        ),
    })
  })

  return server
}

/** Serve the envpkt MCP server over stdio. */
export const startServer = async (): Promise<void> => {
  await createServer().start({ transportType: "stdio" })
}
