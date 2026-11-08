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

const run = (cwd: string, extraEnv: Record<string, string> = {}): { stdout: string; status: number } => {
  const env = { ...process.env, HOME: home, ENVPKT_SEARCH_PATH: "", ...extraEnv }
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

  // ENVPKT_NO_GLOBAL keeps this hermetic: on WSL, functype-os also finds the Windows home
  // (/mnt/c/Users/<you>), which no HOME override can hide.
  it("prints nothing and exits 0 when no config is found", () => {
    const result = run(tmpDir, { ENVPKT_NO_GLOBAL: "1" })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
  })

  it("falls back to the global package in the home folder", () => {
    const global = join(home, ".envpkt", "envpkt.toml")
    mkdirSync(dirname(global), { recursive: true })
    writeFileSync(global, "version = 1\n")
    expect(run(tmpDir).stdout).toBe(global)
  })

  it("skips the global package when ENVPKT_NO_GLOBAL is set", () => {
    const global = join(home, ".envpkt", "envpkt.toml")
    mkdirSync(dirname(global), { recursive: true })
    writeFileSync(global, "version = 1\n")
    expect(run(tmpDir, { ENVPKT_NO_GLOBAL: "1" }).stdout).toBe("")
  })

  it("still honors ENVPKT_SEARCH_PATH when ENVPKT_NO_GLOBAL is set", () => {
    const custom = join(home, "custom", "envpkt.toml")
    mkdirSync(dirname(custom), { recursive: true })
    writeFileSync(custom, "version = 1\n")
    expect(run(tmpDir, { ENVPKT_NO_GLOBAL: "1", ENVPKT_SEARCH_PATH: custom }).stdout).toBe(custom)
  })
})
