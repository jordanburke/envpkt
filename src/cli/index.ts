import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Command } from "commander"

import { runAudit } from "./commands/audit.js"
import { registerEnvCommands } from "./commands/env.js"
import { runExec } from "./commands/exec.js"
import { runFleet } from "./commands/fleet.js"
import { runInit } from "./commands/init.js"
import { runInspect } from "./commands/inspect.js"
import { runKeygen } from "./commands/keygen.js"
import { runMcp } from "./commands/mcp.js"
import { runResolve } from "./commands/resolve.js"
import { runSeal } from "./commands/seal.js"
import { registerSecretCommands } from "./commands/secret.js"
import { runShellHook } from "./commands/shell-hook.js"
import { runUpgrade } from "./commands/upgrade.js"

const program = new Command()

program
  .name("envpkt")
  .description(
    "Credential lifecycle and fleet management for AI agents\n\n" +
      "  Developer workflow:  env scan → keygen → seal → eval $(envpkt env export)\n" +
      "  Agent / CI workflow: catalog → audit --strict → seal → exec --strict → fleet",
  )
  .version(
    (() => {
      const findPkgJson = (dir: string): string => {
        if (existsSync(join(dir, "package.json"))) return join(dir, "package.json")
        const parent = dirname(dir)
        return parent === dir ? "" : findPkgJson(parent)
      }
      const pkgPath = findPkgJson(dirname(fileURLToPath(import.meta.url)))
      return pkgPath ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version : "0.0.0"
    })(),
  )

program
  .command("init")
  .description("Initialize a new envpkt.toml in the current directory")
  .option("--from-fnox [path]", "Scaffold from fnox.toml (optionally specify path)")
  .option("--catalog <path>", "Path to shared secret catalog")
  .option("--identity", "Include [identity] section")
  .option("--name <name>", "Identity name (requires --identity)")
  .option("--capabilities <caps>", "Comma-separated capabilities (requires --identity)")
  .option("--expires <date>", "Credential expiration YYYY-MM-DD (requires --identity)")
  .option("--force", "Overwrite existing envpkt.toml")
  .action((options) => {
    runInit(process.cwd(), options)
  })

program
  .command("keygen")
  .description("Generate an age keypair for sealing secrets — run this before `seal` if you don't have a key yet")
  .option("-c, --config <path>", "Path to envpkt.toml (updates identity.recipient if found)")
  .option("-o, --output <path>", "Output path for identity file (default: ~/.envpkt/<project>-key.txt)")
  .option("--global", "Write key to the shared default path (~/.envpkt/age-key.txt) instead of a project-specific one")
  .action((options) => {
    runKeygen(options)
  })

program
  .command("audit")
  .description("Audit credential health from envpkt.toml (use --strict in CI pipelines to gate deploys)")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("--format <format>", "Output format: table | json | minimal", "table")
  .option("--expiring <days>", "Show secrets expiring within N days", parseInt)
  .option("--status <status>", "Filter by status: healthy | expiring_soon | expired | stale | missing")
  .option("--strict", "Exit non-zero on any non-healthy secret")
  .option("--all", "Show both secrets and env defaults")
  .option("--env-only", "Show only env defaults (drift detection)")
  .option("--sealed", "Show only secrets with encrypted_value")
  .option("--external", "Show only secrets without encrypted_value")
  .action((options) => {
    runAudit(options)
  })

program
  .command("fleet")
  .description("Scan directory tree for envpkt.toml files and aggregate health (use in CI for fleet-wide monitoring)")
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
  .option("--resolved", "Show resolved view (catalog merged)")
  .option("--secrets", "Show secret values from environment (masked by default)")
  .option("--plaintext", "Show secret values in plaintext (requires --secrets)")
  .action((options) => {
    runInspect(options)
  })

program
  .command("exec")
  .description("Run pre-flight audit then execute a command with injected secrets (sealed → fnox → env cascade)")
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
  .command("resolve")
  .description("Resolve catalog references and output a flat, self-contained config")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("-o, --output <path>", "Write resolved config to file (default: stdout)")
  .option("--format <format>", "Output format: toml | json", "toml")
  .option("--dry-run", "Show what would be resolved without writing")
  .action((options) => {
    runResolve(options)
  })

program
  .command("seal")
  .description("Encrypt secret values into envpkt.toml using age — sealed packets are safe to commit to git")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .option("--profile <profile>", "fnox profile to use for value resolution")
  .option("--reseal", "Re-encrypt all secrets, including already sealed (for key rotation)")
  .option("--edit <keys>", "Re-seal specific keys with new values (comma-separated), always prompts interactively")
  .action(async (options) => {
    await runSeal(options)
  })

program
  .command("mcp")
  .description("Start the envpkt MCP server (stdio transport)")
  .option("-c, --config <path>", "Path to envpkt.toml")
  .action((options) => {
    runMcp(options)
  })

registerSecretCommands(program)
registerEnvCommands(program)

program
  .command("upgrade")
  .description("Upgrade envpkt to the latest version (npm install -g envpkt@latest)")
  .action(() => {
    runUpgrade()
  })

program
  .command("shell-hook")
  .description("Output shell function for ambient credential warnings on cd — combine with env export for full setup")
  .argument("<shell>", "Shell type: zsh | bash")
  .action((shell: string) => {
    runShellHook(shell)
  })

program.parse()
