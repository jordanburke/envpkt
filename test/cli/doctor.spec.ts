import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

const __testDir = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__testDir, "../..")
const CLI_SRC = resolve(PROJECT_ROOT, "src/cli/index.ts")
const TSX = resolve(PROJECT_ROOT, "node_modules/.bin/tsx")

const FAKE_CIPHERTEXT = ["-----BEGIN AGE ENCRYPTED FILE-----", "ZmFrZQ==", "-----END AGE ENCRYPTED FILE-----"].join(
  "\n",
)

let tmpDir: string
let home: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "envpkt-doctor-"))
  home = mkdtempSync(join(tmpdir(), "envpkt-doctor-home-"))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

// eslint-disable-next-line no-control-regex -- matching ANSI color escapes
const stripColor = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "")

const run = (configPath: string): { stdout: string; status: number } => {
  const env = { ...process.env, HOME: home }
  delete (env as Record<string, string | undefined>)["ENVPKT_AGE_KEY"]
  delete (env as Record<string, string | undefined>)["ENVPKT_AGE_KEY_FILE"]
  try {
    const stdout = execFileSync(TSX, [CLI_SRC, "doctor", "-c", configPath], { cwd: tmpDir, env, encoding: "utf-8" })
    return { stdout: stripColor(stdout), status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: stripColor(e.stdout ?? ""), status: e.status ?? 1 }
  }
}

describe("envpkt doctor", () => {
  it("reports a key file it can't read on the key line, and exits 1", () => {
    const keyDir = join(tmpDir, "key-dir")
    mkdirSync(keyDir)
    const configPath = join(tmpDir, "envpkt.toml")
    writeFileSync(
      configPath,
      [
        `version = 1`,
        `[identity]`,
        `name = "x"`,
        `recipient = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"`,
        `key_file = "${keyDir}"`,
        `[secret.SEALED_KEY]`,
        `service = "test"`,
        `encrypted_value = """`,
        FAKE_CIPHERTEXT,
        `"""`,
      ].join("\n"),
    )

    const result = run(configPath)
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/✗ key\s+Can't read key file .*key-dir/)
    expect(result.stdout).not.toMatch(/✗ config/)
  })
})
