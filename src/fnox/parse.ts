import { readFileSync } from "node:fs"

import { Either, Left, Right, Try } from "functype"
import { Option } from "functype"
import { parse } from "smol-toml"

import type { FnoxConfig, FnoxError } from "../core/types.js"

/** Read and parse fnox.toml, extracting secret keys and profiles */
export const readFnoxConfig = (path: string): Either<FnoxError, FnoxConfig> =>
  Try(() => readFileSync(path, "utf-8")).fold<Either<FnoxError, FnoxConfig>>(
    (err) => Left({ _tag: "FnoxParseError", message: `Failed to read ${path}: ${err}` }),
    (content) =>
      Try(() => parse(content) as Record<string, unknown>).fold<Either<FnoxError, FnoxConfig>>(
        (err) => Left({ _tag: "FnoxParseError", message: `Failed to parse fnox.toml: ${err}` }),
        (data) => {
          const profiles =
            data["profiles"] && typeof data["profiles"] === "object"
              ? Option(data["profiles"] as Record<string, unknown>)
              : Option<Record<string, unknown>>(undefined)

          const secrets = { ...data }
          delete secrets["profiles"]

          return Right({ secrets, profiles })
        },
      ),
  )

/** Extract the set of secret key names from a parsed fnox config */
export const extractFnoxKeys = (config: FnoxConfig): ReadonlySet<string> => new Set(Object.keys(config.secrets))
