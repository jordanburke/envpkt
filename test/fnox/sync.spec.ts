import { describe, expect, it } from "vitest"

import { compareFnoxAndEnvpkt } from "../../src/fnox/sync.js"

describe("compareFnoxAndEnvpkt", () => {
  it("detects missing keys (in fnox but not envpkt)", () => {
    const fnoxKeys = new Set(["A", "B", "C"])
    const envpktKeys = new Set(["A", "B"])

    const { missing, orphaned } = compareFnoxAndEnvpkt(fnoxKeys, envpktKeys)
    expect(missing.toArray()).toEqual(["C"])
    expect(orphaned.toArray()).toEqual([])
  })

  it("detects orphaned keys (in envpkt but not fnox)", () => {
    const fnoxKeys = new Set(["A"])
    const envpktKeys = new Set(["A", "B", "C"])

    const { missing, orphaned } = compareFnoxAndEnvpkt(fnoxKeys, envpktKeys)
    expect(missing.toArray()).toEqual([])
    expect(orphaned.toArray()).toEqual(["B", "C"])
  })

  it("detects both missing and orphaned", () => {
    const fnoxKeys = new Set(["A", "D"])
    const envpktKeys = new Set(["A", "B"])

    const { missing, orphaned } = compareFnoxAndEnvpkt(fnoxKeys, envpktKeys)
    expect(missing.toArray()).toEqual(["D"])
    expect(orphaned.toArray()).toEqual(["B"])
  })

  it("returns empty lists when sets match", () => {
    const fnoxKeys = new Set(["A", "B"])
    const envpktKeys = new Set(["A", "B"])

    const { missing, orphaned } = compareFnoxAndEnvpkt(fnoxKeys, envpktKeys)
    expect(missing.toArray()).toEqual([])
    expect(orphaned.toArray()).toEqual([])
  })

  it("handles empty sets", () => {
    const { missing, orphaned } = compareFnoxAndEnvpkt(new Set(), new Set())
    expect(missing.toArray()).toEqual([])
    expect(orphaned.toArray()).toEqual([])
  })
})
