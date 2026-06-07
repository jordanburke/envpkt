import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-exec-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const run = (args: string[]): { stdout: string; status: number } => {
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, ...args], {
      cwd: tmpDir,
      env: { ...process.env },
      encoding: "utf-8",
      timeout: 15000,
    })
    return { stdout, status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? "", status: e.status ?? 1 }
  }
}

describe("envpkt exec with namespace", () => {
  it("injects env defaults into the child under the namespaced wire name", () => {
    const toml = `version = 1\n\n[namespace]\nprefix = "CIV"\n\n[env.GREETING]\nvalue = "hello"\n`
    writeFileSync(join(tmpDir, "envpkt.toml"), toml)

    const result = run([
      "exec",
      "--skip-audit",
      "--",
      "node",
      "-e",
      'process.stdout.write(`${process.env.CIV__GREETING ?? "MISSING"}|${process.env.GREETING ?? "unset"}`)',
    ])

    expect(result.status).toBe(0)
    // child sees the wire name, not the logical name
    expect(result.stdout).toContain("hello|unset")
  })
})
