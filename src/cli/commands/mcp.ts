import { startServer } from "../../mcp/server.js"

type McpOptions = {
  readonly config?: string
}

export const runMcp = (options: McpOptions): void => {
  startServer({ configPath: options.config }).catch((err) => {
    console.error("MCP server error:", err)
    process.exit(1)
  })
}
