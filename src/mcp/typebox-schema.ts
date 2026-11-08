import type { Static, TSchema } from "@sinclair/typebox"
import { Value } from "@sinclair/typebox/value"

type Issue = { readonly message: string; readonly path: ReadonlyArray<string> }

type ValidateResult<T> = { readonly value: T } | { readonly issues: ReadonlyArray<Issue> }

/**
 * A TypeBox schema seen as a Standard Schema with Standard JSON Schema, the shape somamcp
 * reads tool parameters through. TypeBox 0.34 doesn't implement either, so this wraps it.
 */
export type TypeBoxStandardSchema<T extends TSchema> = {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: "typebox"
    readonly types?: { readonly input: Static<T>; readonly output: Static<T> }
    readonly validate: (value: unknown) => ValidateResult<Static<T>>
    readonly jsonSchema: {
      readonly input: (options: { readonly target: string }) => Record<string, unknown>
      readonly output: (options: { readonly target: string }) => Record<string, unknown>
    }
  }
}

/** "/a/0/b" (a TypeBox error path, a JSON Pointer) → ["a", "0", "b"] */
const pointerSegments = (pointer: string): ReadonlyArray<string> =>
  pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))

/** TypeBox schemas are JSON Schema plus symbol-keyed metadata, which a JSON round trip drops. */
export const plainJsonSchema = (schema: TSchema): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema)) as Record<string, unknown>

export const typeboxStandardSchema = <T extends TSchema>(schema: T): TypeBoxStandardSchema<T> => {
  const json = plainJsonSchema(schema)
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate: (value) =>
        Value.Check(schema, value)
          ? { value }
          : {
              issues: [...Value.Errors(schema, value)].map((e) => ({
                message: e.message,
                path: pointerSegments(e.path),
              })),
            },
      jsonSchema: {
        input: () => json,
        output: () => json,
      },
    },
  }
}
