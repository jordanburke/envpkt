import { dirname } from "node:path"

import { resolveConfig } from "../../core/catalog.js"
import { loadConfig } from "../../core/config.js"
import { buildMcpHeaders, formatMcpHeadersError } from "../../core/mcp-headers.js"
import { formatError, RED, RESET } from "../output.js"
import { emitWarnings, resolveForEmit } from "./env.js"

type HeadersOptions = {
  readonly config?: string
  readonly profile?: string
}

const SERVER_ENV = "CLAUDE_CODE_MCP_SERVER_NAME"

/**
 * Claude Code `headersHelper` entry point: print the HTTP headers for one MCP server as a
 * JSON object. stdout carries the JSON and nothing else; every diagnostic goes to stderr,
 * because Claude parses stdout verbatim.
 */
export const runHeaders = (serverArg: string | undefined, options: HeadersOptions): void => {
  const server = serverArg ?? process.env[SERVER_ENV]
  if (!server) {
    console.error(`${RED}Error:${RESET} No MCP server named. Pass [server] or set ${SERVER_ENV}.`)
    process.exit(2)
  }

  resolveForEmit(options).fold(
    (err) => {
      console.error(`MCP server "${server}":\n${formatError(err)}`)
      process.exit(2)
    },
    (boot) => {
      emitWarnings(boot)

      // Read mcp bindings from the catalog-merged config, the same view boot resolved values from.
      const headers = loadConfig(boot.configPath)
        .flatMap((config) => resolveConfig(config, dirname(boot.configPath)).map((r) => r.config))
        .fold(
          (err) => {
            console.error(`MCP server "${server}":\n${formatError(err)}`)
            return process.exit(2)
          },
          (config) => buildMcpHeaders(config, boot.secrets, server),
        )

      headers.fold(
        (err) => {
          console.error(`${RED}Error:${RESET} ${formatMcpHeadersError(err)}`)
          process.exit(1)
        },
        (map) => {
          process.stdout.write(`${JSON.stringify(map)}\n`)
        },
      )
    },
  )
}
