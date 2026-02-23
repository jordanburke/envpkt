import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { EnvpktConfigSchema } from "../src/core/schema.js"

const scriptDir = dirname(new URL(import.meta.url).pathname)
const outPath = join(scriptDir, "..", "schemas", "envpkt.schema.json")

mkdirSync(dirname(outPath), { recursive: true })

// The TypeBox schema IS a JSON Schema object — just strip $id and add $schema
const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  ...EnvpktConfigSchema,
}

writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n", "utf-8")

console.log(`Schema written to ${outPath}`)
