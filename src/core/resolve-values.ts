import { createInterface } from "node:readline"

import { fnoxExport } from "../fnox/cli.js"
import { fnoxAvailable } from "../fnox/detect.js"

/** Resolve plaintext values for the given keys via cascade: fnox → env → interactive prompt */
export const resolveValues = async (
  keys: ReadonlyArray<string>,
  profile?: string,
  agentKey?: string,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {}
  const remaining = new Set(keys)

  // Layer 1: try fnox export
  if (fnoxAvailable()) {
    fnoxExport(profile, agentKey).fold(
      () => {
        // fnox export failed — continue to next layer
      },
      (exported) => {
        for (const key of [...remaining]) {
          if (key in exported) {
            result[key] = exported[key]!
            remaining.delete(key)
          }
        }
      },
    )
  }

  // Layer 2: try process.env
  for (const key of [...remaining]) {
    const envValue = process.env[key]
    if (envValue !== undefined && envValue !== "") {
      result[key] = envValue
      remaining.delete(key)
    }
  }

  // Layer 3: interactive prompt for remaining keys
  if (remaining.size > 0 && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr })

    const prompt = (question: string): Promise<string> =>
      new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer))
      })

    for (const key of remaining) {
      const value = await prompt(`Enter value for ${key}: `)
      if (value !== "") {
        result[key] = value
      }
    }

    rl.close()
  }

  return result
}
