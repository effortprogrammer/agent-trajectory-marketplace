import { describe, expect, test } from "bun:test"

import type { HarnessTraceDocument } from "../src/trajectory/adapters/contract"
import { applyPrivacyPass } from "../src/trajectory/privacy/apply"
import {
  type PrivacyFilter,
  type PrivacySpan,
  privacyConfigHash,
  privacyMarker,
  resolvePrivacyPassConfig,
} from "../src/trajectory/privacy/contract"
import { tokensToSpans } from "../src/trajectory/privacy/transformers-runner"

const spanOf = (
  start: number,
  end: number,
  category: PrivacySpan["category"],
  score = 0.99,
): PrivacySpan => ({ start, end, category, score })

// Returns fixed spans per exact text; anything unlisted detects nothing.
const fakeFilter = (byText: ReadonlyMap<string, readonly PrivacySpan[]>): PrivacyFilter => ({
  detect: (texts) => Promise.resolve(texts.map((text) => byText.get(text) ?? [])),
})

const collectedTrace = (events: HarnessTraceDocument["events"]): HarnessTraceDocument => ({
  runtime: "claude-code",
  status: "collected",
  formatVersion: 2,
  eventCount: events.length,
  events,
})

describe("applyPrivacyPass", () => {
  test("masks detected spans in detail and payload leaves and stamps the trace", async () => {
    const detail = "prompt from Jane Doe"
    const output = "reply to jane.doe@example.com about the fix"
    const trace = collectedTrace([
      {
        kind: "llm_call",
        name: "assistant_turn",
        detail,
        payload: { role: "assistant", content: "ok", output },
      },
    ])
    const filter = fakeFilter(
      new Map([
        [detail, [spanOf(12, 20, "person_name")]],
        [output, [spanOf(9, 29, "email")]],
      ]),
    )
    const config = resolvePrivacyPassConfig()
    const result = await applyPrivacyPass(trace, filter, config, new Date("2026-07-14T00:00:00Z"))

    expect(result.maskedSpanCount).toBe(2)
    const event = result.trace.events[0]
    expect(event?.detail).toBe("prompt from [pii:person_name]")
    expect(event?.payload?.output).toBe("reply to [pii:email] about the fix")
    expect(event?.payload?.content).toBe("ok")
    expect(result.trace.privacy).toEqual({
      schemaVersion: 1,
      modelId: "openai/privacy-filter",
      threshold: 0.85,
      maskedCategories: [
        "account_number",
        "address",
        "email",
        "person_name",
        "phone_number",
        "secret",
      ],
      spanCounts: { person_name: 1, email: 1 },
      filteredAt: "2026-07-14T00:00:00.000Z",
    })
    // Input document untouched.
    expect(trace.privacy).toBeUndefined()
    expect(trace.events[0]?.detail).toBe(detail)
  })

  test("respects category allowlist and threshold", async () => {
    const detail = "see https://example.com on 2026-07-14 by Jane"
    const trace = collectedTrace([{ kind: "tool_call", name: "fetch", detail }])
    const filter = fakeFilter(
      new Map([
        [
          detail,
          [spanOf(4, 23, "url"), spanOf(27, 37, "date"), spanOf(41, 45, "person_name", 0.2)],
        ],
      ]),
    )
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    // url/date unmasked by default; person_name below threshold survives.
    expect(result.trace.events[0]?.detail).toBe(detail)
    expect(result.maskedSpanCount).toBe(0)
    expect(result.trace.privacy?.spanCounts).toEqual({})
  })

  test("masks the secret category as [pii:credential] so the detail gate stays clean", async () => {
    const detail = "auth header value abcdef123456"
    const trace = collectedTrace([{ kind: "tool_call", name: "curl", detail }])
    const filter = fakeFilter(new Map([[detail, [spanOf(18, 30, "secret")]]]))
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    expect(result.trace.events[0]?.detail).toBe("auth header value [pii:credential]")
    expect(result.trace.events[0]?.detail).not.toContain("secret")
  })

  test("re-caps the detail lane when markers grow past the cap", async () => {
    const detail = `${"x".repeat(238)} ab`
    const trace = collectedTrace([{ kind: "llm_call", name: "turn", detail }])
    const filter = fakeFilter(new Map([[detail, [spanOf(239, 241, "person_name")]]]))
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    const masked = result.trace.events[0]?.detail ?? ""
    expect(masked.length).toBeLessThanOrEqual(240)
    expect(masked.endsWith("…")).toBe(true)
  })

  test("merges overlapping spans into their union so no detected char stays cleartext", async () => {
    const detail = "call Jane Doe now"
    const trace = collectedTrace([{ kind: "llm_call", name: "turn", detail }])
    const filter = fakeFilter(
      new Map([[detail, [spanOf(5, 13, "person_name"), spanOf(10, 16, "person_name")]]]),
    )
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    // (5,13) and (10,16) merge into (5,16): one marker, nothing left in the clear.
    expect(result.trace.events[0]?.detail).toBe(`call ${privacyMarker("person_name")}w`)
    expect(result.maskedSpanCount).toBe(1)
  })

  test("labels a merged overlap region with its highest-scoring category", async () => {
    const detail = "reach me: 0123456789"
    const trace = collectedTrace([{ kind: "llm_call", name: "turn", detail }])
    const filter = fakeFilter(
      new Map([[detail, [spanOf(10, 16, "email", 0.9), spanOf(12, 20, "phone_number", 0.95)]]]),
    )
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    expect(result.trace.events[0]?.detail).toBe(`reach me: ${privacyMarker("phone_number")}`)
    expect(result.trace.privacy?.spanCounts).toEqual({ phone_number: 1 })
  })

  test("walks nested payload input/output structures", async () => {
    const leaf = "send to +1 415 555 0199 please"
    const trace = collectedTrace([
      {
        kind: "tool_call",
        name: "sms",
        detail: "tool call",
        payload: { input: { args: [{ message: leaf }] } },
      },
    ])
    const filter = fakeFilter(new Map([[leaf, [spanOf(8, 23, "phone_number")]]]))
    const result = await applyPrivacyPass(trace, filter, resolvePrivacyPassConfig())
    const input = result.trace.events[0]?.payload?.input as {
      args: readonly { message: string }[]
    }
    expect(input.args[0]?.message).toBe("send to [pii:phone_number] please")
  })

  test("rejects a filter that returns the wrong number of results", async () => {
    const trace = collectedTrace([{ kind: "llm_call", name: "turn", detail: "hello" }])
    const broken: PrivacyFilter = { detect: () => Promise.resolve([]) }
    expect(applyPrivacyPass(trace, broken, resolvePrivacyPassConfig())).rejects.toThrow(
      "privacy_filter_contract_violation",
    )
  })
})

describe("privacyConfigHash", () => {
  test("is stable under category order and sensitive to threshold", () => {
    const a = resolvePrivacyPassConfig({ maskCategories: ["email", "person_name"] })
    const b = resolvePrivacyPassConfig({ maskCategories: ["person_name", "email"] })
    const c = resolvePrivacyPassConfig({ maskCategories: ["email", "person_name"], threshold: 0.9 })
    expect(privacyConfigHash(a)).toBe(privacyConfigHash(b))
    expect(privacyConfigHash(a)).not.toBe(privacyConfigHash(c))
  })
})

describe("tokensToSpans", () => {
  test("folds BIOES token runs into merged spans with mean scores", () => {
    const spans = tokensToSpans([
      { entity: "B-PERSON_NAME", score: 0.9, start: 5, end: 9 },
      { entity: "E-PERSON_NAME", score: 0.7, start: 10, end: 13 },
      { entity: "S-EMAIL", score: 0.95, start: 20, end: 40 },
    ])
    expect(spans).toEqual([
      { start: 5, end: 13, category: "person_name", score: 0.8 },
      { start: 20, end: 40, category: "email", score: 0.95 },
    ])
  })

  test("ignores tokens without offsets or with unknown labels", () => {
    const spans = tokensToSpans([
      { entity: "B-private_email", score: 0.9 },
      { entity: "B-WIZARDRY", score: 0.9, start: 0, end: 4 },
      { entity: "S-private_phone", score: 0.9, start: 6, end: 10 },
    ])
    expect(spans).toEqual([{ start: 6, end: 10, category: "phone_number", score: 0.9 }])
  })

  test("starts a new span when a B- tag follows the same category", () => {
    const spans = tokensToSpans([
      { entity: "S-PERSON_NAME", score: 0.9, start: 0, end: 4 },
      { entity: "B-PERSON_NAME", score: 0.9, start: 5, end: 9 },
    ])
    expect(spans).toHaveLength(2)
  })
})
