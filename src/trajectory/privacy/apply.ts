import type { HarnessTraceDocument, HarnessTraceEvent } from "../adapters/contract"
import { boundedRedactedString, redactHarnessDetail } from "../adapters/contract"
import {
  type PrivacyFilter,
  type PrivacyPassConfig,
  type PrivacySpan,
  type PrivacyStamp,
  privacyMarker,
} from "./contract"

// Applies the ML privacy pass to a converted trace: every string the trace
// carries — the public-sample `detail` lane and every payload leaf — goes
// through the model in one batch, detected spans are masked in place, and the
// trace is stamped as filtered. Pure with respect to its input document.

export type PrivacyPassResult = Readonly<{
  trace: HarnessTraceDocument
  maskedSpanCount: number
}>

// Both the collect walk and the rebuild walk must visit string leaves in the
// same order; this is the single traversal they share. Returns the rebuilt
// value with each string leaf replaced by visit(leaf).
const mapStringLeaves = (value: unknown, visit: (text: string) => string): unknown => {
  if (typeof value === "string") {
    return visit(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapStringLeaves(item, visit))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStringLeaves(item, visit)]),
    )
  }
  return value
}

// Masks the applicable spans of one text. Overlapping spans are merged into
// their union first — every detected character is masked, never a partial
// remainder — with the merged region labeled by its highest-scoring member.
const maskText = (
  text: string,
  spans: readonly PrivacySpan[],
  config: PrivacyPassConfig,
  spanCounts: Record<string, number>,
): { masked: string; maskedCount: number } => {
  const applicable = spans
    .filter(
      (span) =>
        span.score >= config.threshold &&
        config.maskCategories.includes(span.category) &&
        span.start >= 0 &&
        span.start < span.end &&
        span.end <= text.length,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const merged: Array<{
    start: number
    end: number
    category: PrivacySpan["category"]
    score: number
  }> = []
  for (const span of applicable) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end)
      if (span.score > previous.score) {
        previous.category = span.category
        previous.score = span.score
      }
      continue
    }
    merged.push({ ...span })
  }

  // Splice from the end so earlier replacements do not shift later offsets.
  let masked = text
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const region = merged[index]
    if (region === undefined) {
      continue
    }
    masked = `${masked.slice(0, region.start)}${privacyMarker(region.category)}${masked.slice(region.end)}`
    spanCounts[region.category] = (spanCounts[region.category] ?? 0) + 1
  }
  return { masked, maskedCount: merged.length }
}

export const applyPrivacyPass = async (
  trace: HarnessTraceDocument,
  filter: PrivacyFilter,
  config: PrivacyPassConfig,
  now: Date = new Date(),
): Promise<PrivacyPassResult> => {
  // Both phases walk each event through this one function — detail first,
  // then payload leaves — so the collect order and the rebuild order are
  // identical by construction, not by parallel maintenance.
  const mapEventStrings = (
    event: HarnessTraceEvent,
    visitDetail: (text: string) => string,
    visitLeaf: (text: string) => string,
  ): HarnessTraceEvent => {
    const detail = visitDetail(event.detail)
    if (event.payload === undefined) {
      return { ...event, detail }
    }
    const payload = mapStringLeaves(event.payload, visitLeaf) as NonNullable<
      HarnessTraceEvent["payload"]
    >
    return { ...event, detail, payload }
  }

  const texts: string[] = []
  const collect = (text: string): string => {
    texts.push(text)
    return text
  }
  for (const event of trace.events) {
    mapEventStrings(event, collect, collect)
  }

  const detections = await filter.detect(texts)
  if (detections.length !== texts.length) {
    throw new Error(
      `privacy_filter_contract_violation: sent ${texts.length} texts, got ${detections.length} results`,
    )
  }

  const spanCounts: Record<string, number> = {}
  let maskedSpanCount = 0
  let cursor = 0
  const nextMasked = (text: string): string => {
    const spans = detections[cursor]
    cursor += 1
    const { masked, maskedCount } = maskText(text, spans ?? [], config, spanCounts)
    maskedSpanCount += maskedCount
    return masked
  }

  const events: HarnessTraceEvent[] = trace.events.map((event) => {
    // A PII marker can outgrow the span it replaced, so the detail lane
    // re-applies the collapse/cap and the payload lane re-applies the byte
    // bound after masking.
    let truncated = false
    const rebuilt = mapEventStrings(
      event,
      (detail) => redactHarnessDetail(nextMasked(detail)),
      (leaf) => {
        const bounded = boundedRedactedString(nextMasked(leaf))
        if (bounded.truncated) {
          truncated = true
        }
        return bounded.text
      },
    )
    return truncated && rebuilt.payload !== undefined
      ? { ...rebuilt, payload: { ...rebuilt.payload, truncated: true } }
      : rebuilt
  })
  if (cursor !== texts.length) {
    throw new Error(
      `privacy_filter_contract_violation: rebuild consumed ${cursor} of ${texts.length} texts`,
    )
  }

  const stamp: PrivacyStamp = {
    schemaVersion: 1,
    modelId: config.modelId,
    threshold: config.threshold,
    maskedCategories: [...config.maskCategories].sort(),
    spanCounts,
    filteredAt: now.toISOString(),
  }

  return {
    trace: { ...trace, events, privacy: stamp },
    maskedSpanCount,
  }
}
