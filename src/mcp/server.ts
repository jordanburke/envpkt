import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { readResource, resourceDefinitions } from "./resources.js"
import { callTool, toolDefinitions } from "./tools.js"

export const createServer = (): Server => {
  const server = new Server(
    { name: "envpkt", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        "envpkt provides credential lifecycle awareness for AI agents. Use tools to check health, capabilities, and secret metadata. No secret values are ever exposed.",
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    return callTool(name, (args ?? {}) as Record<string, unknown>)
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...resourceDefinitions],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params
    const result = readResource(uri)
    if (!result) {
      return { contents: [{ uri, mimeType: "text/plain", text: `Resource not found: ${uri}` }] }
    }
    return result
  })

  return server
}

export const startServer = async (): Promise<void> => {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
