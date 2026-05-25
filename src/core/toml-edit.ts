import { Either, List, Option, Set } from "functype"

import type { TomlEditError } from "./types.js"

const SECTION_RE = /^\[.+\]\s*$/
const MULTILINE_OPEN = '"""'

type ScanState = { readonly end: number; readonly inMultiline: boolean; readonly done: boolean }

const scanSectionBoundary = (state: ScanState, line: string, i: number): ScanState => {
  if (state.done) return state

  if (state.inMultiline) {
    return line.includes(MULTILINE_OPEN) ? { ...state, inMultiline: false } : state
  }

  if (line.includes(MULTILINE_OPEN)) {
    const afterEquals = line.slice(line.indexOf("=") + 1).trim()
    const count = (afterEquals.match(new RegExp('"""', "g")) ?? []).length
    return count === 1 ? { ...state, inMultiline: true } : state
  }

  return SECTION_RE.test(line) ? { ...state, end: i, done: true } : state
}

/**
 * Find the line range [start, end) of a TOML section by its header string.
 * The range includes the header line through to (but not including) the next section header or EOF.
 * Handles multiline `"""..."""` values when scanning for section boundaries.
 */
const findSectionRange = (
  lines: ReadonlyArray<string>,
  sectionHeader: string,
  // eslint-disable-next-line functype/prefer-option
): { start: number; end: number } | undefined => {
  const start = lines.findIndex((l) => l.trim() === sectionHeader)
  if (start === -1) return undefined

  const initial: ScanState = { end: lines.length, inMultiline: false, done: false }
  const final = List(lines.slice(start + 1))
    .zipWithIndex()
    .foldLeft<ScanState>(initial)((state, entry) => scanSectionBoundary(state, entry[0], start + 1 + entry[1]))

  return { start, end: final.end }
}

/** Check whether a section header exists in the raw TOML */
const sectionExists = (lines: ReadonlyArray<string>, sectionHeader: string): boolean =>
  lines.some((l) => l.trim() === sectionHeader)

/**
 * Remove a TOML section (e.g. `[secret.X]`) and all its fields through the next section or EOF.
 * Strips trailing blank lines left behind.
 */
export const removeSection = (raw: string, sectionHeader: string): Either<TomlEditError, string> => {
  const lines = raw.split("\n")
  const range = findSectionRange(lines, sectionHeader)
  if (!range) return Either.left({ _tag: "SectionNotFound", section: sectionHeader })

  const after = lines.slice(range.end)

  // Drop trailing blank lines from the kept prefix so the removed section doesn't leave a gap
  const beforeAll = lines.slice(0, range.start)
  const lastNonBlank = beforeAll.findLastIndex((l) => l.trim() !== "")
  const before = lastNonBlank === -1 ? [] : beforeAll.slice(0, lastNonBlank + 1)

  const result = [...before, ...after].join("\n")
  return Either.right(result)
}

/**
 * Rename a TOML section header (e.g. `[secret.OLD]` → `[secret.NEW]`).
 * Errors if old doesn't exist or new already exists.
 */
export const renameSection = (raw: string, oldHeader: string, newHeader: string): Either<TomlEditError, string> => {
  const lines = raw.split("\n")

  if (!sectionExists(lines, oldHeader)) {
    return Either.left({ _tag: "SectionNotFound", section: oldHeader })
  }
  if (sectionExists(lines, newHeader)) {
    return Either.left({ _tag: "SectionAlreadyExists", section: newHeader })
  }

  const result = lines.map((line) => (line.trim() === oldHeader ? newHeader : line)).join("\n")
  return Either.right(result)
}

type UpdateState = {
  readonly remaining: readonly string[]
  readonly updatedKeys: Set<string>
  readonly skipUntil: number
}

/**
 * Update, add, or remove fields within an existing TOML section.
 * - A string value replaces or adds the field
 * - A null value removes the field
 * Does NOT re-serialize — operates on raw text lines.
 */
export const updateSectionFields = (
  raw: string,
  sectionHeader: string,
  // eslint-disable-next-line functype/prefer-option
  updates: Readonly<Record<string, string | null>>,
): Either<TomlEditError, string> => {
  const lines = raw.split("\n")
  const range = findSectionRange(lines, sectionHeader)
  if (!range) return Either.left({ _tag: "SectionNotFound", section: sectionHeader })

  const before = lines.slice(0, range.start + 1) // include header
  const after = lines.slice(range.end)
  const sectionBody = lines.slice(range.start + 1, range.end)

  // Given an opening `"""` at `fromIdx`, return the index of the closing `"""`
  // or sectionBody.length if the multiline is unterminated (skip-to-end fallback).
  const findClosingMultiline = (fromIdx: number): number => {
    const idx = sectionBody.findIndex((l, j) => j > fromIdx && l.includes(MULTILINE_OPEN))
    return idx === -1 ? sectionBody.length : idx
  }

  const initial: UpdateState = {
    remaining: [],
    updatedKeys: Set.empty<string>(),
    skipUntil: -1,
  }

  const step = (state: UpdateState, line: string, i: number): UpdateState => {
    if (i <= state.skipUntil) return state

    const eqIdx = line.indexOf("=")
    const isFieldLine = eqIdx > 0 && !line.trimStart().startsWith("#") && !line.trimStart().startsWith("[")
    const key = isFieldLine ? line.slice(0, eqIdx).trim() : ""

    if (isFieldLine && key in updates) {
      const afterEquals = line.slice(eqIdx + 1).trim()
      const opensMultiline =
        afterEquals.includes(MULTILINE_OPEN) && (afterEquals.match(new RegExp('"""', "g")) ?? []).length === 1
      const skipUntil = opensMultiline ? findClosingMultiline(i) : state.skipUntil
      const updatedKeys = state.updatedKeys.add(key)
      const value = updates[key]

      if (value === null) {
        return { ...state, updatedKeys, skipUntil }
      }
      return {
        remaining: [...state.remaining, `${key} = ${value}`],
        updatedKeys,
        skipUntil,
      }
    }

    return { ...state, remaining: [...state.remaining, line] }
  }

  const final = List(sectionBody).zipWithIndex().foldLeft<UpdateState>(initial)((state, entry) =>
    step(state, entry[0], entry[1]),
  )

  // Append fields that weren't already present
  const newFields = Object.entries(updates)
    .filter(([key, value]) => value !== null && !final.updatedKeys.has(key))
    .map(([key, value]) => `${key} = ${value}`)

  const result = [...before, ...final.remaining, ...newFields, ...after].join("\n")
  return Either.right(result)
}

/**
 * Append a new TOML section block to the end of the file.
 * Ensures proper spacing (double newline before the block).
 */
export const appendSection = (raw: string, block: string): string => `${raw.trimEnd()}\n\n${block}`

// --- Sort / grouping ---

const ENV_HEADER_RE = /^\[env\.(.+)\]\s*$/
const SECRET_HEADER_RE = /^\[secret\.(.+)\]\s*$/
const ANY_HEADER_RE = /^\[.+\]\s*$/

type SectionBlock = {
  readonly kind: "env" | "secret"
  readonly key: string
  /** Header + body lines, in their original textual form. Excludes leading doc-block. */
  readonly body: ReadonlyArray<string>
  /** Comment / blank lines immediately above the header that "belong" to this section. */
  readonly preamble: ReadonlyArray<string>
}

/**
 * Find the end (exclusive) of a section starting at `start`, respecting
 * multiline `"""..."""` values so the scanner does not mistake content inside
 * a multiline string for a section header.
 */
const findSectionEnd = (lines: ReadonlyArray<string>, start: number): number => {
  const initial: ScanState = { end: lines.length, inMultiline: false, done: false }
  const final = List(lines.slice(start + 1))
    .zipWithIndex()
    .foldLeft<ScanState>(initial)((state, entry) => scanSectionBoundary(state, entry[0], start + 1 + entry[1]))
  return final.end
}

/**
 * Walking backwards from `headerIdx`, return the index of the first line of the
 * "doc block" that should travel with this section. A doc block is a contiguous
 * run of `#`-comment lines *immediately* above the header (no blank line
 * between). A blank line acts as a paragraph break and stops the walk — so
 * `# Some heading\n\n[secret.X]` does NOT attach the heading to `[secret.X]`.
 */
const findPreambleStart = (lines: ReadonlyArray<string>, headerIdx: number): number => {
  const above = lines.slice(0, headerIdx)
  // Walk back over a contiguous run of `#` comment lines. The first blank or
  // non-comment line stops the walk.
  const stopOffset = [...above].reverse().findIndex((l) => !l.trim().startsWith("#"))
  return stopOffset === -1 ? 0 : headerIdx - stopOffset
}

/**
 * Split raw TOML into:
 *   - preambleLines: top-of-file lines through the last non-section content
 *   - sections: ordered list of all `[env.*]` and `[secret.*]` blocks (with their doc blocks)
 *   - otherSections: ordered list of any other `[X]` sections (e.g. `[lifecycle]`) and their bodies, kept in original order
 *
 * Sections that aren't env or secret stay in the preamble region, in their original positions.
 */
type Partitioned = {
  readonly preambleLines: ReadonlyArray<string>
  readonly envSections: ReadonlyArray<SectionBlock>
  readonly secretSections: ReadonlyArray<SectionBlock>
}

type HeaderRecord = { readonly idx: number; readonly kind: "env" | "secret" | "other"; readonly key: string }
type HeaderScanState = { readonly headers: ReadonlyArray<HeaderRecord>; readonly inMultiline: boolean }

const classifyHeader = (line: string, idx: number): Option<HeaderRecord> => {
  if (!ANY_HEADER_RE.test(line)) return Option.none<HeaderRecord>()
  const envMatch = line.match(ENV_HEADER_RE)
  if (envMatch) return Option<HeaderRecord>({ idx, kind: "env", key: envMatch[1]! })
  const secretMatch = line.match(SECRET_HEADER_RE)
  if (secretMatch) return Option<HeaderRecord>({ idx, kind: "secret", key: secretMatch[1]! })
  return Option<HeaderRecord>({ idx, kind: "other", key: "" })
}

const scanHeader = (state: HeaderScanState, line: string, idx: number): HeaderScanState => {
  if (state.inMultiline) {
    return line.includes(MULTILINE_OPEN) ? { ...state, inMultiline: false } : state
  }
  if (line.includes(MULTILINE_OPEN)) {
    const afterEq = line.slice(line.indexOf("=") + 1).trim()
    const count = (afterEq.match(new RegExp('"""', "g")) ?? []).length
    return count === 1 ? { ...state, inMultiline: true } : state
  }
  return classifyHeader(line, idx).fold(
    () => state,
    (header) => ({ ...state, headers: [...state.headers, header] }),
  )
}

const partitionSections = (raw: string): Partitioned => {
  const lines = raw.split("\n")

  // Scan all section headers, respecting multiline `"""..."""` so content
  // inside a multiline string isn't mistaken for a header.
  const initialScan: HeaderScanState = { headers: [], inMultiline: false }
  const { headers } = List(lines).zipWithIndex().foldLeft<HeaderScanState>(initialScan)((state, entry) =>
    scanHeader(state, entry[0], entry[1]),
  )

  type EnvOrSecretHeader = { readonly idx: number; readonly kind: "env" | "secret"; readonly key: string }
  const envSecretHeaders: EnvOrSecretHeader[] = headers.filter(
    (h): h is EnvOrSecretHeader => h.kind === "env" || h.kind === "secret",
  )

  // For a section starting at headerIdx, find its "true" content range:
  // from headerIdx through the last non-blank-non-comment line before the next
  // section header (or EOF). Trailing blanks/comments between sections are
  // NOT claimed by either neighbor — they fall through to the global preamble.
  const trueBodyRange = (headerIdx: number): { readonly start: number; readonly end: number } => {
    const naiveEnd = findSectionEnd(lines, headerIdx)
    const candidate = lines.slice(headerIdx, naiveEnd)
    const lastContent = candidate.findLastIndex((l) => {
      const t = l.trim()
      return t !== "" && !t.startsWith("#")
    })
    return { start: headerIdx, end: lastContent === -1 ? headerIdx + 1 : headerIdx + lastContent + 1 }
  }

  const sections: SectionBlock[] = envSecretHeaders.map((h) => {
    const headerIdx = h.idx
    const preambleStart = findPreambleStart(lines, headerIdx)
    const body = lines.slice(headerIdx, trueBodyRange(headerIdx).end)
    const preamble = lines.slice(preambleStart, headerIdx)
    return { kind: h.kind, key: h.key, body, preamble }
  })

  // Claimed ranges: only the env/secret sections' doc-block preamble + true body.
  // Top-level non-env/non-secret content (top keys, [identity], [tools], etc.)
  // and any gutter blanks/region-divider comments between sections fall
  // through to the global preamble region.
  const claimedRanges = envSecretHeaders.map((h) => {
    const headerIdx = h.idx
    return { start: findPreambleStart(lines, headerIdx), end: trueBodyRange(headerIdx).end }
  })

  const isClaimed = (idx: number): boolean => claimedRanges.some((r) => idx >= r.start && idx < r.end)
  const preambleLines = lines.map((l, idx) => (isClaimed(idx) ? null : l)).filter((l): l is string => l !== null)

  const envSections = sections.filter((s) => s.kind === "env")
  const secretSections = sections.filter((s) => s.kind === "secret")

  return { preambleLines, envSections, secretSections }
}

const emitSection = (s: SectionBlock): string => {
  const pre = s.preamble.length > 0 ? `${s.preamble.join("\n")}\n` : ""
  return `${pre}${s.body.join("\n")}`
}

/**
 * Reformat a TOML config with `[env.*]` and `[secret.*]` sections grouped and
 * alphabetized. Top-level content (version key, `[identity]`, `[lifecycle]`,
 * `[callbacks]`, `[tools]`, etc.) stays in its original position. Comment
 * doc-blocks immediately above a section header travel with that section.
 *
 * Pure — no I/O. Returns the raw input unchanged when there is no env or
 * secret content to reorder.
 */
export const sortConfigToml = (raw: string): string => {
  const { preambleLines, envSections, secretSections } = partitionSections(raw)

  if (envSections.length === 0 && secretSections.length === 0) {
    return raw
  }

  const sortedEnv = [...envSections].sort((a, b) => a.key.localeCompare(b.key))
  const sortedSecret = [...secretSections].sort((a, b) => a.key.localeCompare(b.key))

  // Normalize preamble: trim trailing blanks; collapse runs of 2+ blank lines
  // into a single blank so removing claimed sections doesn't leave huge gaps.
  const trimTrailing = (xs: ReadonlyArray<string>): ReadonlyArray<string> => {
    const lastNonBlank = xs.findLastIndex((l) => l.trim() !== "")
    return lastNonBlank === -1 ? [] : xs.slice(0, lastNonBlank + 1)
  }
  const collapseBlanks = (xs: ReadonlyArray<string>): ReadonlyArray<string> =>
    xs.reduce<string[]>((acc, line) => {
      const isBlank = line.trim() === ""
      const prevBlank = acc.length > 0 && acc[acc.length - 1]!.trim() === ""
      if (isBlank && prevBlank) return acc
      return [...acc, line]
    }, [])
  const preambleTrimmed = collapseBlanks(trimTrailing(preambleLines))

  const parts: string[] = []
  if (preambleTrimmed.length > 0) parts.push(preambleTrimmed.join("\n"))
  if (sortedEnv.length > 0) parts.push(sortedEnv.map(emitSection).join("\n\n"))
  if (sortedSecret.length > 0) parts.push(sortedSecret.map(emitSection).join("\n\n"))

  // Join regions with a blank line between, end with a single trailing newline.
  return `${parts.join("\n\n")}\n`
}
