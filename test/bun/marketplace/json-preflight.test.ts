import { describe, expect, test } from "bun:test"

import { parseAdmissionJson } from "../../../src/marketplace/json-preflight"

describe("admission JSON preflight", () => {
  test("accepts deeply nested but bounded JSON", () => {
    // Given: a valid document nested well inside the depth budget.
    const depth = 400
    const text = "[".repeat(depth) + "1" + "]".repeat(depth)

    // When: the preflight parses it.
    const parsed = parseAdmissionJson(Buffer.from(text, "utf8"))

    // Then: bounded depth is admitted.
    expect(parsed).not.toBeUndefined()
  })

  test("rejects pathological nesting without a stack overflow", () => {
    // Given: a document nested far beyond the parser stack.
    const text = "[".repeat(100_000) + "]".repeat(100_000)

    // When: the preflight scans it.
    // Then: rejection is a stable undefined, never a RangeError.
    expect(() => parseAdmissionJson(Buffer.from(text, "utf8"))).not.toThrow()
    expect(parseAdmissionJson(Buffer.from(text, "utf8"))).toBeUndefined()
  })
})
