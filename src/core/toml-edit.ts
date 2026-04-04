import { Either } from "functype"

import type { TomlEditError } from "./types.js"

const SECTION_RE = /^\[.+\]\s*$/
const MULTILINE_OPEN = '"""'

/**
 * Find the line range [start, end) of a TOML section by its header string.
 * The range includes the header line through to (but not including) the next section header or EOF.
 * Handles multiline `"""..."""` values when scanning for section boundaries.
 */
const findSectionRange = (
  lines: ReadonlyArray<string>,
  sectionHeader: string,
): { start: number; end: number } | undefined => {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === sectionHeader) {
      start = i
      break
    }
  }
  if (start === -1) return undefined

  let end = lines.length
  let inMultiline = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!

    if (inMultiline) {
      if (line.includes(MULTILINE_OPEN)) inMultiline = false
      continue
    }

    if (line.includes(MULTILINE_OPEN)) {
      const afterEquals = line.slice(line.indexOf("=") + 1).trim()
      // Opening """ — check if it also closes on same line (unlikely for encrypted_value but handle it)
      const count = (afterEquals.match(new RegExp('"""', "g")) ?? []).length
      if (count === 1) inMultiline = true
      continue
    }

    if (SECTION_RE.test(line)) {
      end = i
      break
    }
  }

  return { start, end }
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

  // Also remove any trailing blank lines after the section
  let removeEnd = range.end
  while (removeEnd > range.start && removeEnd - 1 >= range.start && lines[removeEnd - 1]!.trim() === "") {
    removeEnd--
  }
  // Keep the section content removal but strip blank lines before next section
  const before = lines.slice(0, range.start)
  const after = lines.slice(range.end)

  // Remove trailing blank lines from `before`
  while (before.length > 0 && before[before.length - 1]!.trim() === "") {
    before.pop()
  }

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

/**
 * Update, add, or remove fields within an existing TOML section.
 * - A string value replaces or adds the field
 * - A null value removes the field
 * Does NOT re-serialize — operates on raw text lines.
 */
export const updateSectionFields = (
  raw: string,
  sectionHeader: string,
  updates: Readonly<Record<string, string | null>>,
): Either<TomlEditError, string> => {
  const lines = raw.split("\n")
  const range = findSectionRange(lines, sectionHeader)
  if (!range) return Either.left({ _tag: "SectionNotFound", section: sectionHeader })

  const before = lines.slice(0, range.start + 1) // include header
  const after = lines.slice(range.end)

  // Parse existing fields in the section body
  const sectionBody = lines.slice(range.start + 1, range.end)
  const remaining: string[] = []
  const updatedKeys = new Set<string>()

  let inMultiline = false
  let multilineKey = ""
  for (let i = 0; i < sectionBody.length; i++) {
    const line = sectionBody[i]!

    if (inMultiline) {
      if (line.includes(MULTILINE_OPEN)) {
        inMultiline = false
        // If removing this key, skip the closing line too
        if (updates[multilineKey] === null) continue
        if (multilineKey in updates) {
          // Already handled when we saw the opening line
          continue
        }
      } else {
        if (updates[multilineKey] === null) continue
        if (multilineKey in updates) continue
      }
      remaining.push(line)
      continue
    }

    // Check for key = value line
    const eqIdx = line.indexOf("=")
    if (eqIdx > 0 && !line.trimStart().startsWith("#") && !line.trimStart().startsWith("[")) {
      const key = line.slice(0, eqIdx).trim()

      if (key in updates) {
        updatedKeys.add(key)
        const afterEquals = line.slice(eqIdx + 1).trim()

        // Check for multiline opening
        if (afterEquals.includes(MULTILINE_OPEN)) {
          const count = (afterEquals.match(new RegExp('"""', "g")) ?? []).length
          if (count === 1) {
            inMultiline = true
            multilineKey = key
          }
        }

        if (updates[key] === null) {
          // Remove: skip this line (and multiline content handled above)
          continue
        }
        // Replace
        remaining.push(`${key} = ${updates[key]}`)
        // If multiline was opening, skip through closing
        if (inMultiline) {
          for (let j = i + 1; j < sectionBody.length; j++) {
            if (sectionBody[j]!.includes(MULTILINE_OPEN)) {
              i = j
              inMultiline = false
              break
            }
          }
        }
        continue
      }
    }

    remaining.push(line)
  }

  // Add new fields that weren't already in the section
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && !updatedKeys.has(key)) {
      remaining.push(`${key} = ${value}`)
    }
  }

  const result = [...before, ...remaining, ...after].join("\n")
  return Either.right(result)
}

/**
 * Append a new TOML section block to the end of the file.
 * Ensures proper spacing (double newline before the block).
 */
export const appendSection = (raw: string, block: string): string => `${raw.trimEnd()}\n\n${block}`
