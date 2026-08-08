import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import {
  SelectionContractError,
  encodeSelectionDocument,
  parseSelectionDocument,
  selectionDocumentFromTraces,
} from "../../../src/marketplace/selection-contract"
import type { SelectionDocument } from "../../../src/marketplace/selection-contract"
import { fullSelectorSchema, traceHashSchema } from "../../../src/marketplace/session-contract"
import type { FrozenTrace } from "../../../src/marketplace/session-contract"

const selectorA = `s-${"a".repeat(64)}`
const selectorB = `s-${"b".repeat(64)}`

const traceBytes = (runtime: string, request: string): Buffer =>
  Buffer.from(JSON.stringify({
    runtime,
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{ kind: "function_enter", name: "turn", payload: { role: "user", content: request } }],
  }), "utf8")

const trace = (relativePath: string, runtime: string, request: string): FrozenTrace => {
  const bytes = traceBytes(runtime, request)
  return {
    byteCount: bytes.byteLength,
    bytes,
    earliestTimestamp: "unknown",
    eventCount: 1,
    hash: traceHashSchema.parse(createHash("sha256").update(bytes).digest("hex")),
    relativePath,
    runtime,
    selector: fullSelectorSchema.parse(`s-${createHash("sha256").update(relativePath).digest("hex")}`),
  }
}

const document: SelectionDocument = selectionDocumentFromTraces("/tmp/sessions", [
  trace("a.atf.json", "codex", "first"),
  trace("b.atf.json", "claude-code", "second"),
])

describe("selection document contract", () => {
  test("round-trips a canonical document with artifact and content fields", () => {
    // Given: a valid selection document built from frozen traces.
    const encoded = encodeSelectionDocument(document)

    // When: the document is parsed again.
    const parsed = parseSelectionDocument(encoded)

    // Then: every selector carries raw and artifact bindings plus legible content fields.
    expect(parsed).toEqual(document)
    const first = parsed.traces[0]
    if (first === undefined) throw new Error("missing trace")
    expect(first.runtime.length).toBeGreaterThan(0)
    expect(first.eventCount).toBe(1)
    expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
    const summaryRequests = parsed.traces.flatMap((trace) => trace.summary.requests).sort()
    expect(summaryRequests).toEqual(["first", "second"])
    expect(parsed.traces.every((trace) => trace.summary.counts.requests === 1)).toBe(true)
    expect(encoded.toString("utf8").endsWith("\n")).toBe(true)
  })

  test("canonicalizes unsorted membership to identical bytes", () => {
    // Given: the same membership in reversed order.
    const reversed = { ...document, traces: [...document.traces].reverse() }

    // When: both orders are encoded.
    // Then: equivalent membership serializes byte-identically.
    expect(encodeSelectionDocument(reversed).equals(encodeSelectionDocument(document))).toBe(true)
  })

  test.each([
    ["empty membership", { ...document, traces: [] }],
    ["duplicate selectors", { ...document, traces: [document.traces[0], document.traces[0]] }],
    ["unknown field", { ...document, unexpected: true }],
    ["relative root", { ...document, root: "relative/path" }],
    ["missing artifact binding", { ...document, traces: [{ byteCount: 1, selector: selectorA, sha256: "1".repeat(64) }] }],
  ] as const)("rejects %s through the parse boundary", (_case, input) => {
    // Given: raw bytes violating the closed selection contract.
    const bytes = Buffer.from(JSON.stringify(input), "utf8")

    // When: the bytes cross the parse boundary directly.
    const parse = (): void => {
      parseSelectionDocument(bytes)
    }

    // Then: membership ambiguity fails closed at parse time.
    expect(parse).toThrow(SelectionContractError)
  })

  test("rejects malformed and duplicate-key JSON bytes", () => {
    // Given: raw bytes that are not a strict unique-key JSON document.
    const malformed = Buffer.from("{", "utf8")
    const duplicated = Buffer.from(
      `{"root":"/tmp/sessions","root":"/tmp/sessions","schemaVersion":1,"traces":[]}`,
      "utf8",
    )

    // When: each crosses the parse boundary.
    // Then: neither can select membership.
    expect(() => parseSelectionDocument(malformed)).toThrow(SelectionContractError)
    expect(() => parseSelectionDocument(duplicated)).toThrow(SelectionContractError)
  })

  test("rejects membership above the archive trace cap", () => {
    // Given: a document claiming more traces than the dataset archive admits.
    const entry = document.traces[0]
    if (entry === undefined) throw new Error("missing trace")
    const oversized = Buffer.from(JSON.stringify({
      root: "/tmp/sessions",
      schemaVersion: 1,
      traces: Array.from({ length: 101 }, (_, index) => ({
        ...entry,
        selector: fullSelectorSchema.parse(`s-${String(index).padStart(64, "0")}`),
      })),
    }), "utf8")

    // When: the document crosses the parse boundary.
    // Then: the cap rejects it at admission.
    expect(() => parseSelectionDocument(oversized)).toThrow(SelectionContractError)
  })

  test("rejects pathological nesting as a stable contract error", () => {
    // Given: a deeply nested hostile document.
    const nested = Buffer.from("[".repeat(100_000) + "]".repeat(100_000), "utf8")

    // When: the preflight scans it.
    // Then: rejection is the stable contract error, never a RangeError.
    expect(() => parseSelectionDocument(nested)).toThrow(SelectionContractError)
  })
})
