import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { FormatPacketOptions } from "../src/core/format.js"
import { formatPacket } from "../src/core/format.js"
import { apiGatewayResult, dataPipelineResult, demoSecrets, monitoringResult } from "../test/fixtures/demo-data.js"

// ---------------------------------------------------------------------------
// CSS template — macOS terminal chrome, dark theme, JetBrains Mono
// ---------------------------------------------------------------------------

const CSS = `body {
  margin: 0;
  padding: 0;
  background: #1e1e2e;
  display: flex;
  justify-content: center;
  padding-top: 32px;
  padding-bottom: 32px;
}
.term {
  background: #282a36;
  border-radius: 10px;
  max-width: 820px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.bar {
  background: #343746;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.r { background: #ff5f57; }
.y { background: #febc2e; }
.g { background: #28c840; }
.cmd {
  color: #8b8fa3;
  font-size: 13px;
  margin-left: 12px;
  font-family: monospace;
}
pre {
  font-family: "JetBrains Mono", Menlo, Monaco, monospace;
  font-size: 13.5px;
  line-height: 1.7;
  color: #abb2bf;
  padding: 20px 24px;
  margin: 0;
  white-space: pre-wrap;
}
b { color: #e8e8e8; font-weight: 600; }
.dim { opacity: 0.55; }
.cyan { color: #56b6c2; }
.yellow { color: #e5c07b; }`

// ---------------------------------------------------------------------------
// HTML styling: apply bold, dim, yellow, cyan to plain-text output
// ---------------------------------------------------------------------------

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const styleLine = (line: string): string => {
  let styled = escapeHtml(line)

  // Bold section headers
  styled = styled.replace(/^(envpkt packet:.*)$/, "<b>$1</b>")
  styled = styled.replace(/^(secrets: \d+)$/, "<b>$1</b>")
  styled = styled.replace(/^(lifecycle:)$/, "<b>$1</b>")
  styled = styled.replace(/^(catalog: .*)$/, (_, m) => {
    const [label, ...rest] = m.split(": ")
    const path = rest.join(": ")
    return `<b>${label}:</b> <span class="cyan">${path}</span>`
  })

  // Bold secret key names (indented lines with →)
  styled = styled.replace(/^( {2})(\S+)( → .*)$/, "$1<b>$2</b>$3")

  // Yellow masked values (••••• pattern)
  styled = styled.replace(/ = (\S*•{5}\S*)/, ' = <span class="yellow">$1</span>')

  // Yellow plaintext values (after = on secret lines)
  if (styled.includes("<b>") && styled.includes(" → ") && styled.includes(" = ") && !styled.includes("yellow")) {
    styled = styled.replace(/ = (.+)$/, ' = <span class="yellow">$1</span>')
  }

  // Dim URLs
  styled = styled.replace(/(rotation_url: )(.+)/, '$1<span class="dim">$2</span>')

  // Dim capabilities values
  styled = styled.replace(/(capabilities: )(.+)/, '$1<span class="dim">$2</span>')

  return styled
}

const applyStyles = (text: string): string =>
  text
    .split("\n")
    .map((line) => styleLine(line))
    .join("\n")

// ---------------------------------------------------------------------------
// Generate HTML document
// ---------------------------------------------------------------------------

const generateHtml = (title: string, command: string, body: string): string =>
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
${CSS}
    </style>
  </head>
  <body>
    <div class="term">
      <div class="bar">
        <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="cmd">${escapeHtml(command)}</span>
      </div>
      <pre>${body}</pre>
    </div>
  </body>
</html>
`

// ---------------------------------------------------------------------------
// Build output for each mode
// ---------------------------------------------------------------------------

type DemoAgent = {
  readonly name: string
  readonly result: typeof apiGatewayResult
  readonly secrets: Record<string, string>
}

const agents: ReadonlyArray<DemoAgent> = [
  {
    name: "api-gateway",
    result: { ...apiGatewayResult, catalogPath: "examples/demo/infra/envpkt.toml" },
    secrets: { DATABASE_URL: demoSecrets.DATABASE_URL, STRIPE_SECRET_KEY: demoSecrets.STRIPE_SECRET_KEY },
  },
  {
    name: "data-pipeline",
    result: { ...dataPipelineResult, catalogPath: "examples/demo/infra/envpkt.toml" },
    secrets: { DATABASE_URL: demoSecrets.DATABASE_URL, REDIS_URL: demoSecrets.REDIS_URL },
  },
  {
    name: "monitoring",
    result: monitoringResult,
    secrets: { DATADOG_API_KEY: demoSecrets.DATADOG_API_KEY, SLACK_WEBHOOK_URL: demoSecrets.SLACK_WEBHOOK_URL },
  },
]

const buildContent = (mode: "none" | "encrypted" | "plaintext"): string =>
  agents
    .map((agent) => {
      const opts: FormatPacketOptions | undefined =
        mode === "none" ? undefined : { secrets: agent.secrets, secretDisplay: mode }
      return formatPacket(agent.result, opts)
    })
    .join("\n\n" + "─".repeat(72) + "\n\n")

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const scriptDir = dirname(new URL(import.meta.url).pathname)
const outDir = join(scriptDir, "..", "examples", "demo")

mkdirSync(outDir, { recursive: true })

// Delete old single-file output
const oldFile = join(outDir, "inspect-output.html")
if (existsSync(oldFile)) {
  unlinkSync(oldFile)
  console.log(`Deleted ${oldFile}`)
}

const modes = [
  { file: "inspect-no-secrets.html", mode: "none" as const, command: "envpkt inspect" },
  { file: "inspect-encrypted.html", mode: "encrypted" as const, command: "envpkt inspect --secrets" },
  { file: "inspect-plaintext.html", mode: "plaintext" as const, command: "envpkt inspect --secrets --plaintext" },
]

for (const { file, mode, command } of modes) {
  const content = buildContent(mode)
  const styled = applyStyles(content)
  const html = generateHtml(`envpkt inspect — ${mode}`, command, styled)
  const outPath = join(outDir, file)
  writeFileSync(outPath, html, "utf-8")
  console.log(`Generated ${outPath}`)
}
