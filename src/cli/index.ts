import { Command } from "commander"

import { runAudit } from "./commands/audit.js"
import { runExec } from "./commands/exec.js"
import { runFleet } from "./commands/fleet.js"
import { runInit } from "./commands/init.js"
import { runInspect } from "./commands/inspect.js"
import { runMcp } from "./commands/mcp.js"

const program = new Command()

program.name("envpkt").description("Credential lifecycle and fleet management for AI agents").version("0.1.0")

program
  .command("init")
  .description("Initialize a new envpkt.toml in the current directory")
  .option("--from-fnox [path]", "Scaffold from fnox.toml (optionally specify path)")
  .option("--agent", "Include [agent] section")
  .option("--name <name>", "Agent name (requires --agent)")
  .option("--capabilities <caps>", "Comma-separated capabilities (requires --agent)")
  .option("--expires <date>", "Agent credential expiration YYYY-MM-DD (requires --agent)")
  .option("--force", "Overwrite existing envpkt.toml")
  .action((options) => {
    runInit(process.cwd(), options)
  })

program
  .command("audit")
  .description("Audit credential health from envpkt.toml")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("--format <format>", "Output format: table | json | minimal", "table")
  .option("--expiring <days>", "Show secrets expiring within N days", parseInt)
  .option("--status <status>", "Filter by status: healthy | expiring_soon | expired | stale | missing")
  .option("--strict", "Exit non-zero on any non-healthy secret")
  .action((options) => {
    runAudit(options)
  })

program
  .command("fleet")
  .description("Scan directory tree for envpkt.toml files and aggregate health")
  .option("-d, --dir <path>", "Root directory to scan", ".")
  .option("--depth <n>", "Max directory depth", parseInt)
  .option("--format <format>", "Output format: table | json", "table")
  .option("--status <status>", "Filter agents by health status")
  .action((options) => {
    runFleet(options)
  })

program
  .command("inspect")
  .description("Display structured view of envpkt.toml")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("--format <format>", "Output format: table | json", "table")
  .action((options) => {
    runInspect(options)
  })

program
  .command("exec")
  .description("Run pre-flight audit then execute a command with fnox-injected env")
  .argument("<command...>", "Command to execute")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("--profile <profile>", "fnox profile to use")
  .option("--skip-audit", "Skip the pre-flight audit (alias: --no-check)")
  .option("--no-check", "Skip the pre-flight audit")
  .option("--warn-only", "Warn on critical audit but do not abort")
  .option("--strict", "Abort on any non-healthy secret")
  .action((args: string[], options) => {
    runExec(args, options)
  })

program
  .command("mcp")
  .description("Start the envpkt MCP server (stdio transport)")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .action((options) => {
    runMcp(options)
  })

program.parse()
