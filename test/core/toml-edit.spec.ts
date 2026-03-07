import { describe, expect, it } from "vitest"

import { appendSection, removeSection, renameSection, updateSectionFields } from "../../src/core/toml-edit.js"

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
