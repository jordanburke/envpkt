import { Either, List, Set } from "functype"

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
