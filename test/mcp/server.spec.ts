import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { packageVersion } from "../../src/core/version.js"
import { createServer, type McpServerOptions } from "../../src/mcp/server.js"

const config = `
version = 1

[identity]
name = "test-agent"
consumer = "agent"
capabilities = ["read"]

[secret.API_KEY]
service = "stripe"
purpose = "Payment processing"
created = "2026-01-01"
encrypted_value = "-----BEGIN AGE ENCRYPTED FILE-----\\nNOT-REAL-CIPHERTEXT\\n-----END AGE ENCRYPTED FILE-----"
`

const ENVPKT_TOOLS = ["checkExpiration", "getEnvMeta", "getPacketHealth", "getSecretMeta", "listCapabilities"]

type TextResult = { content: Array<{ type: string; text?: string }>; isError?: boolean }

const text = (result: unknown): string => (result as TextResult).content.map((c) => c.text ?? "").join("")

let tmpDir: string
let configPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-mcp-server-"))
  configPath = join(tmpDir, "envpkt.toml")
  writeFileSync(configPath, config)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmpDir, { recursive: true, force: true })
})

/** A real SDK 2.x client wired straight into the server's fetch handler, no port. */
const connect = async (options: McpServerOptions = {}): Promise<Client> => {
  const server = createServer(options)
  const client = new Client({ name: "envpkt-test", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://envpkt.test/mcp"), {
      fetch: (input, init) => server.fetch(new Request(input, init)),
    }),
  )
  return client
}

describe("MCP server (somamcp)", () => {
  it("reports envpkt's package version", async () => {
    const client = await connect()
    expect(client.getServerVersion()).toMatchObject({ name: "envpkt", version: packageVersion() })
    await client.close()
  })

  it("lists the five envpkt tools, all read-only", async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    const envpktTools = tools.filter((t) => ENVPKT_TOOLS.includes(t.name))

    expect(envpktTools.map((t) => t.name).sort()).toEqual(ENVPKT_TOOLS)
    envpktTools.forEach((t) => expect(t.annotations?.readOnlyHint).toBe(true))
    expect(tools.find((t) => t.name === "getSecretMeta")?.inputSchema).toMatchObject({
      type: "object",
      required: ["key"],
      properties: { key: { type: "string" }, configPath: { type: "string" } },
    })
    await client.close()
  })

  it("calls a tool with its arguments", async () => {
    const client = await connect()
    const result = await client.callTool({ name: "getPacketHealth", arguments: { configPath } })

    expect((result as TextResult).isError).toBeFalsy()
    expect(JSON.parse(text(result))).toMatchObject({ path: configPath, total: 1 })
    await client.close()
  })

  it("rejects arguments that fail the TypeBox schema", async () => {
    const client = await connect()
    const result = await client.callTool({ name: "getSecretMeta", arguments: { configPath } })

    expect((result as TextResult).isError).toBe(true)
    expect(text(result)).toContain("key")
    await client.close()
  })

  it("never returns sealed ciphertext", async () => {
    const client = await connect()
    const result = await client.callTool({ name: "getSecretMeta", arguments: { key: "API_KEY", configPath } })

    expect(JSON.parse(text(result))).toMatchObject({ key: "API_KEY", service: "stripe" })
    expect(text(result)).not.toContain("encrypted_value")
    expect(text(result)).not.toContain("NOT-REAL-CIPHERTEXT")
    await client.close()
  })

  it("serves the health resource", async () => {
    vi.stubEnv("ENVPKT_CONFIG", configPath)
    const client = await connect()
    const { contents } = await client.readResource({ uri: "envpkt://health" })

    expect(contents[0]).toMatchObject({ uri: "envpkt://health", mimeType: "application/json" })
    expect(JSON.parse((contents[0] as { text: string }).text)).toMatchObject({ path: configPath, total: 1 })
    await client.close()
  })
})

describe("a pinned config path (envpkt mcp -c)", () => {
  it("is the default for tools", async () => {
    const client = await connect({ configPath })
    const result = await client.callTool({ name: "getSecretMeta", arguments: { key: "API_KEY" } })

    expect(JSON.parse(text(result))).toMatchObject({ key: "API_KEY", service: "stripe" })
    await client.close()
  })

  it("gives way to a configPath the tool call names", async () => {
    const otherPath = join(tmpDir, "other.toml")
    writeFileSync(otherPath, 'version = 1\n\n[secret.OTHER]\nservice = "other"\n')
    const client = await connect({ configPath })
    const result = await client.callTool({ name: "getPacketHealth", arguments: { configPath: otherPath } })

    expect(JSON.parse(text(result))).toMatchObject({ path: otherPath, total: 1 })
    await client.close()
  })

  it("is the config resources read", async () => {
    vi.stubEnv("ENVPKT_CONFIG", join(tmpDir, "missing.toml"))
    const client = await connect({ configPath })
    const { contents } = await client.readResource({ uri: "envpkt://health" })

    expect(JSON.parse((contents[0] as { text: string }).text)).toMatchObject({ path: configPath })
    await client.close()
  })
})

describe("envpkt mcp (stdio)", () => {
  type RpcMessage = { jsonrpc?: unknown; id?: unknown; result?: { content: Array<{ text: string }> } }

  const parseLine = (line: string): RpcMessage | undefined => {
    try {
      return JSON.parse(line) as RpcMessage
    } catch {
      return undefined
    }
  }

  it("writes only JSON-RPC to stdout, and reads the config -c names", async () => {
    const { ENVPKT_CONFIG: _, ...env } = process.env
    const cli = join(import.meta.dirname, "../../src/cli/index.ts")
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), cli, "mcp", "-c", configPath], {
      cwd: tmpDir,
      env: { ...env, ENVPKT_NO_GLOBAL: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    })

    const lines: string[] = []
    const answered = new Promise<void>((resolve) => {
      let buffer = ""
      child.stdout.on("data", (chunk: Buffer) => {
        const parts = (buffer + chunk.toString()).split("\n")
        buffer = parts.pop() ?? ""
        lines.push(...parts.filter((l) => l.length > 0))
        if (lines.some((l) => parseLine(l)?.id === 2)) resolve()
      })
    })

    const send = (message: Record<string, unknown>): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
    }
    send({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1.0.0" } },
    })
    send({ method: "notifications/initialized" })
    send({ id: 2, method: "tools/call", params: { name: "getPacketHealth", arguments: {} } })

    await answered
    child.kill()

    // Every stdout line must be a JSON-RPC message: a stray log line would corrupt the channel.
    const messages = lines.map(parseLine)
    messages.forEach((m, i) => expect(m?.jsonrpc, `stdout line ${i}: ${lines[i]}`).toBe("2.0"))
    const call = messages.find((m) => m?.id === 2)
    expect(JSON.parse(call?.result?.content[0]?.text ?? "{}")).toMatchObject({ path: configPath })
  }, 20_000)
})
