import { describe, expect, test } from "bun:test"

import { hasOnlyCompensatedModelUsage } from "../../../src/marketplace/compensated-model-policy"
import {
  harnessTraceDocumentSchema,
  type HarnessTraceDocument,
} from "../../../src/trajectory/adapters/contract"

const traceDocumentForModel = (model: string): HarnessTraceDocument =>
  harnessTraceDocumentSchema.parse({
    runtime: "codex",
    status: "collected",
    formatVersion: 2,
    eventCount: 1,
    events: [{
      kind: "message",
      name: "assistant",
      timestamp: "2026-09-01T00:00:00.000Z",
      sourceEventId: "usage-0",
      payload: { usage: { model, inputTokens: 3, outputTokens: 2 } },
    }],
  })

const asciiWhitespace: ReadonlyArray<readonly [label: string, wrap: string]> = [
  ["space U+0020", "\u0020"],
  ["tab U+0009", "\u0009"],
  ["carriage return U+000D", "\u000D"],
  ["line feed U+000A", "\u000A"],
  ["form feed U+000C", "\u000C"],
  ["vertical tab U+000B", "\u000B"],
]

const nonAsciiWhitespace: ReadonlyArray<readonly [label: string, wrap: string]> = [
  ["byte order mark U+FEFF", "\uFEFF"],
  ["next line U+0085", "\u0085"],
  ["no-break space U+00A0", "\u00A0"],
]

describe("compensated model policy normalization", () => {
  test.each(asciiWhitespace)(
    "admits mixed-case claude-fable-5 wrapped in ASCII %s",
    (_, wrap) => {
      // Given: a source-attested usage event whose model is mixed-case claude-fable-5
      // surrounded by a single ASCII whitespace code point on each side.
      const document = traceDocumentForModel(`${wrap}Claude-Fable-5${wrap}`)

      // When: the compensated-model policy evaluates the parsed document.
      const admitted = hasOnlyCompensatedModelUsage(document)

      // Then: ASCII-only normalization reaches the canonical compensated id.
      expect(admitted).toBe(true)
    },
  )

  test("admits mixed-case claude-fable-5 surrounded by every ASCII whitespace code point", () => {
    // Given: a source-attested usage event whose model is mixed-case claude-fable-5
    // prefixed and suffixed with space, tab, vertical tab, form feed, CR, and LF.
    const document = traceDocumentForModel(
      " \t\u000B\u000C\r\nClaude-Fable-5\n\r\u000C\u000B\t ",
    )

    // When: the compensated-model policy evaluates the parsed document.
    const admitted = hasOnlyCompensatedModelUsage(document)

    // Then: ASCII-only normalization reaches the canonical compensated id.
    expect(admitted).toBe(true)
  })

  test.each(nonAsciiWhitespace)(
    "rejects claude-fable-5 wrapped in non-ASCII %s",
    (_, wrap) => {
      // Given: a source-attested usage event whose model is mixed-case claude-fable-5
      // surrounded by a single non-ASCII whitespace code point on each side.
      const document = traceDocumentForModel(`${wrap}Claude-Fable-5${wrap}`)

      // When: the compensated-model policy evaluates the parsed document.
      const admitted = hasOnlyCompensatedModelUsage(document)

      // Then: no Unicode whitespace normalization may reach the compensated id set.
      expect(admitted).toBe(false)
    },
  )
})
