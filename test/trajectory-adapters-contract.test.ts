import { describe, expect, test } from "bun:test"

import {
  boundedRedactedString,
  extractHarnessSourceAttestation,
  harnessCollectedStatus,
  harnessPayloadPolicy,
  harnessTraceDocumentSchema,
  harnessTraceEventSchema,
  sanitizeHarnessPayload,
} from "../src/trajectory/adapters/contract"
import { trajectoryObservationPolicy } from "../src/trajectory/observation-contract"

const validTimestamp = "2026-07-18T12:34:56.000Z"
const validTimestamp2 = "2026-07-18T12:34:57.000Z"

const minimalEvent = { kind: "function_enter", name: "turn-1", detail: "Fix the bug" } as const

const payloadOnlyEvent = {
  kind: "tool_call",
  name: "terminal",
  detail: "rg login src/",
  payload: { toolUseId: "call_1", input: { command: "rg login src/" } },
} as const

describe("harnessTraceEventSchema source attestation", () => {
  test("accepts an event with kind/name/detail only (v1 compat)", () => {
    const result = harnessTraceEventSchema.safeParse(minimalEvent)
    expect(result.success).toBe(true)
  })

  test("accepts a payload-only event (existing adapter contract)", () => {
    const result = harnessTraceEventSchema.safeParse(payloadOnlyEvent)
    expect(result.success).toBe(true)
  })

  test("accepts timestamp + sourceEventId together", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: validTimestamp,
      sourceEventId: "evt-1",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timestamp).toBe(validTimestamp)
      expect(result.data.sourceEventId).toBe("evt-1")
      expect(result.data.parentSourceEventId).toBeUndefined()
    }
  })

  test("accepts timestamp + sourceEventId + parentSourceEventId together", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: validTimestamp,
      sourceEventId: "evt-2",
      parentSourceEventId: "evt-1",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.parentSourceEventId).toBe("evt-1")
    }
  })

  test("rejects a partial group: timestamp without sourceEventId", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: validTimestamp,
    })
    expect(result.success).toBe(false)
  })

  test("rejects a partial group: sourceEventId without timestamp", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      sourceEventId: "evt-1",
    })
    expect(result.success).toBe(false)
  })

  test("rejects parentSourceEventId without timestamp + sourceEventId", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      parentSourceEventId: "evt-1",
    })
    expect(result.success).toBe(false)
  })

  test("rejects parentSourceEventId with only timestamp (no sourceEventId)", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: validTimestamp,
      parentSourceEventId: "evt-1",
    })
    expect(result.success).toBe(false)
  })

  test("rejects malformed timestamps even when sourceEventId is present", () => {
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: "2026/07/18 12:34:56",
      sourceEventId: "evt-1",
    })
    expect(result.success).toBe(false)
  })

  test("rejects source IDs exceeding the shared bound", () => {
    const overlong = "x".repeat(trajectoryObservationPolicy.maxSourceEventIdChars + 1)
    const result = harnessTraceEventSchema.safeParse({
      ...minimalEvent,
      timestamp: validTimestamp,
      sourceEventId: overlong,
    })
    expect(result.success).toBe(false)
  })
})

describe("harnessTraceDocumentSchema source attestation", () => {
  const baseDoc = {
    runtime: "claude-code",
    status: harnessCollectedStatus,
    eventCount: 1,
    events: [minimalEvent],
  } as const

  test("accepts a v1-style doc without formatVersion and without attestation", () => {
    const result = harnessTraceDocumentSchema.safeParse(baseDoc)
    expect(result.success).toBe(true)
  })

  test("accepts a payload-only doc with formatVersion 2 and no attestation", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      formatVersion: 2 as const,
      events: [{ ...payloadOnlyEvent }],
    })
    expect(result.success).toBe(true)
  })

  test("rejects a payload-only doc without formatVersion 2", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      events: [{ ...payloadOnlyEvent }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain("format_version_2_required_with_payload_or_source_attestation")
    }
  })

  test("rejects an eventCount that disagrees with events", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      eventCount: 2,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain("event_count_mismatch")
    }
  })

  test("accepts a doc with formatVersion 2 and a complete attestation group", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      formatVersion: 2 as const,
      eventCount: 2,
      events: [
        { ...minimalEvent, timestamp: validTimestamp, sourceEventId: "evt-1" },
        {
          ...minimalEvent,
          timestamp: validTimestamp2,
          sourceEventId: "evt-2",
          parentSourceEventId: "evt-1",
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  test("rejects duplicate sourceEventIds across events", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      formatVersion: 2 as const,
      events: [
        { ...minimalEvent, timestamp: validTimestamp, sourceEventId: "dup" },
        { ...minimalEvent, timestamp: validTimestamp2, sourceEventId: "dup" },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain("duplicate_source_event_id")
    }
  })

  test("requires formatVersion 2 when any event has attestation fields", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      events: [{ ...minimalEvent, timestamp: validTimestamp, sourceEventId: "evt-1" }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain("format_version_2_required_with_payload_or_source_attestation")
    }
  })

  test("requires formatVersion 2 when an event carries a payload", () => {
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      events: [{ ...payloadOnlyEvent }],
    })
    expect(result.success).toBe(false)
  })

  test("retains a truncation marker when aggregate payload size exceeds the cap", () => {
    const oversizedText = "x".repeat(16 * 1024)
    const oversized = {
      content: oversizedText,
      input: {
        command: oversizedText,
        cwd: oversizedText,
        path: oversizedText,
        query: oversizedText,
      },
      output: { stderr: oversizedText, stdout: oversizedText },
      label: oversizedText,
    }
    expect(sanitizeHarnessPayload(oversized)).toEqual({ truncated: true })
  })

  test("keeps the truncation marker within the parser string bound", () => {
    const bounded = boundedRedactedString("x".repeat(harnessPayloadPolicy.maxStringBytes + 128))
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, "utf8")).toBeLessThanOrEqual(
      harnessPayloadPolicy.maxStringBytes,
    )
    const result = harnessTraceDocumentSchema.safeParse({
      ...baseDoc,
      formatVersion: 2 as const,
      events: [{ ...minimalEvent, payload: { output: bounded.text, truncated: true } }],
    })
    expect(result.success).toBe(true)
  })
})

describe("extractHarnessSourceAttestation", () => {
  test("returns undefined for null / undefined / non-object inputs", () => {
    expect(extractHarnessSourceAttestation(null)).toBeUndefined()
    expect(extractHarnessSourceAttestation(undefined)).toBeUndefined()
    expect(extractHarnessSourceAttestation("not-an-object")).toBeUndefined()
    expect(extractHarnessSourceAttestation(42)).toBeUndefined()
  })

  test("returns undefined when timestamp is missing", () => {
    expect(extractHarnessSourceAttestation({ sourceEventId: "evt-1" })).toBeUndefined()
  })

  test("returns undefined when sourceEventId is missing", () => {
    expect(extractHarnessSourceAttestation({ timestamp: validTimestamp })).toBeUndefined()
  })

  test("returns undefined when timestamp is malformed", () => {
    expect(
      extractHarnessSourceAttestation({ timestamp: "nope", sourceEventId: "evt-1" }),
    ).toBeUndefined()
  })

  test("returns undefined when sourceEventId exceeds the bound", () => {
    const overlong = "x".repeat(trajectoryObservationPolicy.maxSourceEventIdChars + 1)
    expect(
      extractHarnessSourceAttestation({ timestamp: validTimestamp, sourceEventId: overlong }),
    ).toBeUndefined()
  })

  test("returns complete metadata without parent when parent is absent", () => {
    const result = extractHarnessSourceAttestation({
      timestamp: validTimestamp,
      sourceEventId: "evt-1",
    })
    expect(result).toEqual({ timestamp: validTimestamp, sourceEventId: "evt-1" })
  })

  test("returns complete metadata with parent when parent is valid", () => {
    const result = extractHarnessSourceAttestation({
      timestamp: validTimestamp,
      sourceEventId: "evt-2",
      parentSourceEventId: "evt-1",
    })
    expect(result).toEqual({
      timestamp: validTimestamp,
      sourceEventId: "evt-2",
      parentSourceEventId: "evt-1",
    })
  })

  test("omits an invalid parent but keeps the rest of the group", () => {
    const result = extractHarnessSourceAttestation({
      timestamp: validTimestamp,
      sourceEventId: "evt-2",
      parentSourceEventId: "",
    })
    expect(result).toEqual({ timestamp: validTimestamp, sourceEventId: "evt-2" })
  })

  test("does not synthesize IDs when raw fields are empty", () => {
    expect(
      extractHarnessSourceAttestation({ timestamp: validTimestamp, sourceEventId: "" }),
    ).toBeUndefined()
  })

  test("ignores surrounding unknown fields on the raw object", () => {
    const result = extractHarnessSourceAttestation({
      timestamp: validTimestamp,
      sourceEventId: "evt-1",
      kind: "function_enter",
      name: "turn-1",
      detail: "irrelevant",
    })
    expect(result).toEqual({ timestamp: validTimestamp, sourceEventId: "evt-1" })
  })
})
