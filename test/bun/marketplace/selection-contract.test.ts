import { describe, expect, test } from "bun:test"

import {
  SelectionContractError,
  encodeSelectionDocument,
  parseSelectionDocument,
  selectionDocumentFromTraces,
} from "../../../src/marketplace/selection-contract"
import { fullSelectorSchema, traceHashSchema } from "../../../src/marketplace/session-contract"
import type { FrozenTrace } from "../../../src/marketplace/session-contract"

const selectorA = `s-${"a".repeat(64)}`
const selectorB = `s-${"b".repeat(64)}`
const hashA = "1".repeat(64)
const hashB = "2".repeat(64)

const trace = (selector: string, hash: string, byteCount: number): FrozenTrace => ({
  byteCount,
  bytes: new Uint8Array(byteCount),
  earliestTimestamp: "unknown",
  eventCount: 0,
  hash: traceHashSchema.parse(hash),
  relativePath: `runtime/${selector}.atf.json`,
  runtime: "codex",
  selector: fullSelectorSchema.parse(selector),
})

const document = {
  root: "/tmp/sessions",
  schemaVersion: 1,
  traces: [
    { byteCount: 12, selector: fullSelectorSchema.parse(selectorA), sha256: traceHashSchema.parse(hashA) },
    { byteCount: 34, selector: fullSelectorSchema.parse(selectorB), sha256: traceHashSchema.parse(hashB) },
  ],
} as const

describe("selection document contract", () => {
  test("round-trips a canonical document in frozen property order", () => {
    // Given: a valid selection document built from frozen traces.
    const built = selectionDocumentFromTraces("/tmp/sessions", [
      trace(selectorB, hashB, 34),
      trace(selectorA, hashA, 12),
    ])

    // When: the document is encoded and parsed again.
    const encoded = encodeSelectionDocument(built)
    const parsed = parseSelectionDocument(encoded)

    // Then: selectors are sorted and the encoding is byte-stable.
    expect(encoded.toString("utf8").endsWith("\n")).toBe(true)
    expect(parsed).toEqual(document)
    expect(encodeSelectionDocument(parsed).equals(encoded)).toBe(true)
  })

  test.each([
    ["empty membership", { ...document, traces: [] }],
    ["duplicate selectors", { ...document, traces: [document.traces[0], document.traces[0]] }],
    ["unknown field", { ...document, unexpected: true }],
    ["relative root", { ...document, root: "relative/path" }],
    ["mismatched byte count", { ...document, traces: [{ byteCount: -1, selector: selectorA, sha256: hashA }] }],
    ["malformed selector", { ...document, traces: [{ byteCount: 1, selector: "codex:abc", sha256: hashA }] }],
  ] as const)("rejects %s", (_case, input) => {
    // Given: a document violating the closed selection contract.
    // When: it crosses the parse boundary.
    const parse = (): void => {
      parseSelectionDocument(encodeSelectionDocument(input))
    }

    // Then: membership ambiguity fails closed.
    expect(parse).toThrow(SelectionContractError)
  })

  test("rejects malformed and duplicate-key JSON bytes", () => {
    // Given: raw bytes that are not a strict unique-key JSON document.
    const malformed = Buffer.from("{", "utf8")
    const duplicated = Buffer.from(
      `{"root":"/tmp/sessions","root":"/tmp/sessions","schemaVersion":1,"traces":[{"byteCount":12,"selector":"${selectorA}","sha256":"${hashA}"}]}`,
      "utf8",
    )

    // When: each crosses the parse boundary.
    // Then: neither can select membership.
    expect(() => parseSelectionDocument(malformed)).toThrow(SelectionContractError)
    expect(() => parseSelectionDocument(duplicated)).toThrow(SelectionContractError)
  })

  test("rejects membership above the trace cap without materializing it", () => {
    // Given: a document claiming more traces than the admission budget.
    const oversized = Buffer.from(JSON.stringify({
      root: "/tmp/sessions",
      schemaVersion: 1,
      traces: Array.from({ length: 10_001 }, (_, index) => ({
        byteCount: 1,
        selector: `s-${String(index).padStart(64, "0")}`,
        sha256: hashA,
      })),
    }), "utf8")

    // When: the document crosses the parse boundary.
    // Then: the cap rejects it.
    expect(() => parseSelectionDocument(oversized)).toThrow(SelectionContractError)
  })
})
