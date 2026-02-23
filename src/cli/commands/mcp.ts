import { startServer } from "../../mcp/server.js"

export const runMcp = (_options: Record<string, unknown>): void => {
  startServer().catch((err) => {
    console.error("MCP server error:", err)
    process.exit(1)
  })
}
