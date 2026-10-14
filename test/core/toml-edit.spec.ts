import { describe, expect, it } from "vitest"

import {
  appendSection,
  removeSection,
  renameSection,
  replaceSection,
  sortConfigToml,
  updateSectionFields,
} from "../../src/core/toml-edit.js"

const baseToml = `version = 1

[secret.FIRST]
service = "alpha"
purpose = "Testing"

[secret.SECOND]
service = "beta"
expires = "2027-01-01"

[secret.THIRD]
service = "gamma"
`

describe("removeSection", () => {
  it("removes a middle section", () => {
    const result = removeSection(baseToml, "[secret.SECOND]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("[secret.SECOND]")
    expect(text).not.toContain('service = "beta"')
    expect(text).toContain("[secret.FIRST]")
    expect(text).toContain("[secret.THIRD]")
  })

  it("removes the first section", () => {
    const result = removeSection(baseToml, "[secret.FIRST]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("[secret.FIRST]")
    expect(text).toContain("[secret.SECOND]")
    expect(text).toContain("[secret.THIRD]")
  })

  it("removes the last section", () => {
    const result = removeSection(baseToml, "[secret.THIRD]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("[secret.THIRD]")
    expect(text).toContain("[secret.FIRST]")
    expect(text).toContain("[secret.SECOND]")
  })

  it("removes the only section", () => {
    const single = `version = 1\n\n[secret.ONLY]\nservice = "only"\n`
    const result = removeSection(single, "[secret.ONLY]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("[secret.ONLY]")
    expect(text).toContain("version = 1")
  })

  it("handles multiline encrypted_value", () => {
    const withSealed = `version = 1

[secret.SEALED]
service = "vault"
encrypted_value = """
AGE_ENCRYPTED_DATA
LINE2
"""

[secret.KEEP]
service = "keep"
`
    const result = removeSection(withSealed, "[secret.SEALED]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("[secret.SEALED]")
    expect(text).not.toContain("AGE_ENCRYPTED_DATA")
    expect(text).toContain("[secret.KEEP]")
  })

  it("keeps one blank line between the neighbours of a removed middle section", () => {
    const text = removeSection(baseToml, "[secret.SECOND]").fold(
      () => "",
      (v) => v,
    )
    expect(text).toBe(`version = 1

[secret.FIRST]
service = "alpha"
purpose = "Testing"

[secret.THIRD]
service = "gamma"
`)
  })

  it("keeps the comment above the next section", () => {
    const withDivider = `version = 1

[secret.A]
service = "a"

# ---- group B ----
[secret.B]
service = "b"
`
    const text = removeSection(withDivider, "[secret.A]").fold(
      () => "",
      (v) => v,
    )
    expect(text).toBe(`version = 1

# ---- group B ----
[secret.B]
service = "b"
`)
  })

  it("returns SectionNotFound for missing section", () => {
    const result = removeSection(baseToml, "[secret.NOPE]")
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => {
        expect(err._tag).toBe("SectionNotFound")
        expect(err.section).toBe("[secret.NOPE]")
      },
      () => expect.unreachable("Should be Left"),
    )
  })
})

describe("replaceSection", () => {
  const replaced = (raw: string, header: string, block: string): string =>
    replaceSection(raw, header, block).fold(
      (err) => expect.unreachable(`Should be Right, got ${err._tag}`),
      (v) => v,
    )

  it("replaces a middle section in place, leaving every other line alone", () => {
    expect(replaced(baseToml, "[secret.SECOND]", `[secret.SECOND]\nservice = "new"\n`)).toBe(`version = 1

[secret.FIRST]
service = "alpha"
purpose = "Testing"

[secret.SECOND]
service = "new"

[secret.THIRD]
service = "gamma"
`)
  })

  it("replaces the first section in place", () => {
    expect(replaced(baseToml, "[secret.FIRST]", `[secret.FIRST]\nservice = "new"\n`)).toBe(
      baseToml.replace(`service = "alpha"\npurpose = "Testing"`, `service = "new"`),
    )
  })

  it("replaces the last section and ends with one newline", () => {
    expect(replaced(baseToml, "[secret.THIRD]", `[secret.THIRD]\nservice = "new"\n`)).toBe(
      baseToml.replace(`service = "gamma"`, `service = "new"`),
    )
  })

  it("replaces a section holding a multiline encrypted_value", () => {
    const withSealed = `version = 1

[secret.SEALED]
service = "vault"
encrypted_value = """
OLD_LINE1
[not.a.header]
"""

[secret.KEEP]
service = "keep"
`
    const block = `[secret.SEALED]\nservice = "vault"\nencrypted_value = """\nNEW_LINE1\n"""\n`
    expect(replaced(withSealed, "[secret.SEALED]", block)).toBe(`version = 1

[secret.SEALED]
service = "vault"
encrypted_value = """
NEW_LINE1
"""

[secret.KEEP]
service = "keep"
`)
  })

  it("keeps a comment between the replaced section and the next header", () => {
    const withDivider = `[secret.A]
service = "a"

# ---- group B ----
[secret.B]
service = "b"
`
    expect(replaced(withDivider, "[secret.A]", `[secret.A]\nservice = "z"\n`)).toBe(
      withDivider.replace(`service = "a"`, `service = "z"`),
    )
  })

  it("returns SectionNotFound for a missing section", () => {
    const result = replaceSection(baseToml, "[secret.NOPE]", `[secret.NOPE]\n`)
    result.fold(
      (err) => expect(err).toEqual({ _tag: "SectionNotFound", section: "[secret.NOPE]" }),
      () => expect.unreachable("Should be Left"),
    )
  })
})

describe("renameSection", () => {
  it("renames a section header", () => {
    const result = renameSection(baseToml, "[secret.FIRST]", "[secret.RENAMED]")
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).toContain("[secret.RENAMED]")
    expect(text).not.toContain("[secret.FIRST]")
    expect(text).toContain('service = "alpha"')
  })

  it("errors if old section not found", () => {
    const result = renameSection(baseToml, "[secret.NOPE]", "[secret.NEW]")
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SectionNotFound"),
      () => expect.unreachable("Should be Left"),
    )
  })

  it("errors if new section already exists", () => {
    const result = renameSection(baseToml, "[secret.FIRST]", "[secret.SECOND]")
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SectionAlreadyExists"),
      () => expect.unreachable("Should be Left"),
    )
  })
})

describe("updateSectionFields", () => {
  it("replaces an existing field", () => {
    const result = updateSectionFields(baseToml, "[secret.FIRST]", { service: '"updated"' })
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).toContain('service = "updated"')
    expect(text).not.toContain('service = "alpha"')
    expect(text).toContain('purpose = "Testing"')
  })

  it("adds a new field", () => {
    const result = updateSectionFields(baseToml, "[secret.FIRST]", { rotates: '"90d"' })
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).toContain('rotates = "90d"')
    expect(text).toContain('service = "alpha"')
  })

  it("removes a field with null", () => {
    const result = updateSectionFields(baseToml, "[secret.FIRST]", { purpose: null })
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).not.toContain("purpose")
    expect(text).toContain('service = "alpha"')
  })

  it("handles array and object values", () => {
    const result = updateSectionFields(baseToml, "[secret.FIRST]", {
      capabilities: '["read", "write"]',
      tags: '{ env = "prod" }',
    })
    expect(result.isRight()).toBe(true)
    const text = result.fold(
      () => "",
      (v) => v,
    )
    expect(text).toContain('capabilities = ["read", "write"]')
    expect(text).toContain('tags = { env = "prod" }')
  })

  it("errors on missing section", () => {
    const result = updateSectionFields(baseToml, "[secret.NOPE]", { service: '"x"' })
    expect(result.isLeft()).toBe(true)
    result.fold(
      (err) => expect(err._tag).toBe("SectionNotFound"),
      () => expect.unreachable("Should be Left"),
    )
  })
})

describe("appendSection", () => {
  it("appends a block with proper spacing", () => {
    const block = `[secret.NEW]\nservice = "new"\n`
    const result = appendSection(baseToml, block)
    expect(result).toContain("[secret.NEW]")
    expect(result).toContain("[secret.THIRD]")
    // Should have double newline before the new block
    expect(result).toContain("\n\n[secret.NEW]")
  })
})

describe("sortConfigToml", () => {
  it("groups env above secret and alphabetizes within each", () => {
    const input = `version = 1

[secret.ZEBRA]
service = "z"

[env.BANANA]
value = "yellow"

[secret.APPLE]
service = "a"

[env.AVOCADO]
value = "green"
`
    const sorted = sortConfigToml(input)
    const envIdx = sorted.indexOf("[env.AVOCADO]")
    const envIdx2 = sorted.indexOf("[env.BANANA]")
    const secIdx = sorted.indexOf("[secret.APPLE]")
    const secIdx2 = sorted.indexOf("[secret.ZEBRA]")
    expect(envIdx).toBeGreaterThan(-1)
    // env before its alphabetical successor
    expect(envIdx).toBeLessThan(envIdx2)
    // both env headers before any secret header
    expect(envIdx2).toBeLessThan(secIdx)
    // secret in alphabetical order
    expect(secIdx).toBeLessThan(secIdx2)
  })

  it("is idempotent", () => {
    const input = `version = 1

[env.B]
value = "b"

[env.A]
value = "a"
`
    const once = sortConfigToml(input)
    const twice = sortConfigToml(once)
    expect(twice).toBe(once)
  })

  it("returns input unchanged when there are no env or secret sections", () => {
    const input = `version = 1

[identity]
name = "test"
`
    expect(sortConfigToml(input)).toBe(input)
  })

  it("preserves top-level keys and other sections like [identity] and [lifecycle]", () => {
    const input = `version = 1

[identity]
name = "test"

[lifecycle]
stale_warning_days = 30

[secret.B]
service = "b"

[secret.A]
service = "a"
`
    const sorted = sortConfigToml(input)
    expect(sorted).toContain("[identity]")
    expect(sorted).toContain("[lifecycle]")
    expect(sorted).toContain('name = "test"')
    expect(sorted.indexOf("[secret.A]")).toBeLessThan(sorted.indexOf("[secret.B]"))
    // Identity stays before secrets
    expect(sorted.indexOf("[identity]")).toBeLessThan(sorted.indexOf("[secret.A]"))
  })

  it("attaches a contiguous comment block immediately above a section header to that section", () => {
    const input = `version = 1

# Comment for B (immediately above, no blank between)
[secret.B]
service = "b"

[secret.A]
service = "a"
`
    const sorted = sortConfigToml(input)
    // After sort A is first, B is second. The comment must travel with B.
    const aIdx = sorted.indexOf("[secret.A]")
    const bIdx = sorted.indexOf("[secret.B]")
    const commentIdx = sorted.indexOf("# Comment for B")
    expect(aIdx).toBeLessThan(commentIdx)
    expect(commentIdx).toBeLessThan(bIdx)
    // The comment is on the line directly above [secret.B]
    expect(sorted).toContain("# Comment for B (immediately above, no blank between)\n[secret.B]")
  })

  it("does NOT attach a comment separated from the section by a blank line", () => {
    const input = `version = 1

# Region divider

[secret.B]
service = "b"

[secret.A]
service = "a"
`
    const sorted = sortConfigToml(input)
    // The "Region divider" comment stays in preamble (does NOT travel with B).
    expect(sorted).not.toContain("# Region divider\n[secret.B]")
    // And it's still preserved somewhere in the output.
    expect(sorted).toContain("# Region divider")
  })

  it("preserves multiline encrypted_value blocks", () => {
    const input = `version = 1

[secret.B]
service = "b"
encrypted_value = """
-----BEGIN AGE ENCRYPTED FILE-----
ciphertext-line-1
ciphertext-line-2
-----END AGE ENCRYPTED FILE-----
"""

[secret.A]
service = "a"
`
    const sorted = sortConfigToml(input)
    expect(sorted).toContain("ciphertext-line-1")
    expect(sorted).toContain("ciphertext-line-2")
    expect(sorted).toContain('encrypted_value = """')
    // A still comes before B
    expect(sorted.indexOf("[secret.A]")).toBeLessThan(sorted.indexOf("[secret.B]"))
  })

  it("handles env-only and secret-only files", () => {
    const envOnly = `version = 1

[env.B]
value = "b"

[env.A]
value = "a"
`
    const envSorted = sortConfigToml(envOnly)
    expect(envSorted.indexOf("[env.A]")).toBeLessThan(envSorted.indexOf("[env.B]"))
    expect(envSorted).not.toContain("[secret.")

    const secretOnly = `version = 1

[secret.B]
service = "b"

[secret.A]
service = "a"
`
    const secretSorted = sortConfigToml(secretOnly)
    expect(secretSorted.indexOf("[secret.A]")).toBeLessThan(secretSorted.indexOf("[secret.B]"))
    expect(secretSorted).not.toContain("[env.")
  })
})
