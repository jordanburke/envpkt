import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

let tmpDir: string
let home: string

beforeEach(() => {
  // realpath to canonicalize macOS /var → /private/var so paths match the CLI's resolved cwd
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "envpkt-cfgpath-")))
  home = mkdtempSync(join(tmpdir(), "envpkt-cfgpath-home-"))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const run = (cwd: string): { stdout: string; status: number } => {
  const env = { ...process.env, HOME: home, ENVPKT_SEARCH_PATH: "" }
  delete (env as Record<string, string | undefined>)["ENVPKT_CONFIG"]
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, "config-path"], { cwd, env, encoding: "utf-8" })
    return { stdout: stdout.trim(), status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: (e.stdout ?? "").trim(), status: e.status ?? 1 }
  }
}

describe("envpkt config-path", () => {
  it("prints the resolved config path for the current directory", () => {
    const cfg = join(tmpDir, "envpkt.toml")
    writeFileSync(cfg, "version = 1\n")
    const result = run(tmpDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(cfg)
  })

  it("walks up to a parent config from a subdirectory", () => {
    const cfg = join(tmpDir, "envpkt.toml")
    writeFileSync(cfg, "version = 1\n")
    const deep = join(tmpDir, "a", "b")
    mkdirSync(deep, { recursive: true })
    expect(run(deep).stdout).toBe(cfg)
  })

  it("prints nothing and exits 0 when no config is found", () => {
    const result = run(tmpDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })
})
