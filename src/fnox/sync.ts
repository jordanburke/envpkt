import { List } from "functype"

/** Compare fnox keys and envpkt meta keys to find mismatches */
export const compareFnoxAndEnvpkt = (
  fnoxKeys: ReadonlySet<string>,
  envpktKeys: ReadonlySet<string>,
): { missing: List<string>; orphaned: List<string> } => {
  const missing = List([...fnoxKeys].filter((k) => !envpktKeys.has(k)))
  const orphaned = List([...envpktKeys].filter((k) => !fnoxKeys.has(k)))
  return { missing, orphaned }
}
