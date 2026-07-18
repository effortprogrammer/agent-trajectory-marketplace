import { z } from "zod"

import { redactCredentialSpans } from "../credential-redaction"
import { atfTimestampSchema } from "../observation-contract"
import { privacyStampSchema } from "../privacy/contract"
import { mapStringLeaves } from "../string-leaves"

import { harnessSourceEventIdSchema } from "./source-attestation"

// Re-export the source-attestation schema/type/helper so existing adapter
// imports from "./contract" keep working after the extraction.
export {
  extractHarnessSourceAttestation,
  type HarnessSourceAttestation,
  harnessSourceEventIdSchema,
} from "./source-attestation"

// Harness adapters convert coding-harness session logs that already exist on
// the seller's machine into ATF trace documents. Traces produced this way use
// status "collected" (vs "instrumented" for the Python prototype demo).
export const harnessCollectedStatus = "collected" as const

// High-fidelity payload (ATF formatVersion 2). Optional per event: `detail`
// stays the redacted, capped, public-safe one-line summary; `payload` carries
// the full content that makes a trajectory sellable — the actual observation
// (tool output), the complete action (tool input), assistant block structure,
// usage, and outcome. Payloads ride in the escrowed trace bytes and are never
// read by the public sample derivation (which only touches detail).
// See .omx/specs/high-fidelity-trajectory.md.
const assistantBlockSchema = z
  .object({
    type: z.enum(["text", "tool_use", "thinking"]),
    text: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
  })
  .strict()

const usageSchema = z
  .object({
    model: z.string().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    // Codex rollouts (event_msg token_count.info.last_token_usage) break out
    // cached input and reasoning output separately. Both are optional so the
    // claude-code adapter (which only has input/output) keeps its shape.
    cachedInputTokens: z.number().int().nonnegative().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    // Cache write (cache creation in Anthropic terms, cacheWrite in OpenClaw,
    // cache_write_tokens in Hermes) — distinct from cached input reads.
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
  })
  .strict()

export const harnessEventPayloadSchema = z
  .object({
    role: z.enum(["user", "assistant"]).optional(),
    // user prompt (function_enter) full text.
    content: z.union([z.string(), z.array(assistantBlockSchema)]).optional(),
    // tool_call action / tool_result observation.
    toolUseId: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    isError: z.boolean().optional(),
    byteCount: z.number().int().nonnegative().optional(),
    // Set when a field was truncated to the payload byte cap.
    truncated: z.boolean().optional(),
    usage: usageSchema.optional(),
    // verification / terminal outcome.
    passed: z.boolean().optional(),
    label: z.string().optional(),
  })
  .strict()
export type HarnessEventPayload = z.infer<typeof harnessEventPayloadSchema>

export const harnessTraceEventSchema = z
  .object({
    kind: z.string().min(1),
    name: z.string().min(1),
    detail: z.string(),
    // Source attestation group (ATF formatVersion 2). Adapters that can read
    // stable event IDs and timestamps fill all three; adapters that cannot
    // omit them entirely. Partial groups are rejected so a buyer never sees a
    // timestamp it cannot anchor to a source event.
    timestamp: atfTimestampSchema.optional(),
    sourceEventId: harnessSourceEventIdSchema.optional(),
    parentSourceEventId: harnessSourceEventIdSchema.optional(),
    payload: harnessEventPayloadSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasTimestamp = value.timestamp !== undefined
    const hasSourceEventId = value.sourceEventId !== undefined
    const hasParentSourceEventId = value.parentSourceEventId !== undefined
    if (hasTimestamp !== hasSourceEventId) {
      if (!hasTimestamp) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timestamp"],
          message: "timestamp_required_with_source_event_id",
        })
      }
      if (!hasSourceEventId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceEventId"],
          message: "source_event_id_required_with_timestamp",
        })
      }
    }
    if (hasParentSourceEventId && !(hasTimestamp && hasSourceEventId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentSourceEventId"],
        message: "parent_source_event_id_requires_source_attestation",
      })
    }
  })
export type HarnessTraceEvent = z.infer<typeof harnessTraceEventSchema>

export const harnessTraceDocumentSchema = z
  .object({
    runtime: z.string().min(1),
    status: z.literal(harnessCollectedStatus),
    // Omitted or 1 = summary-only; 2 = fidelity-optional events.
    formatVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(harnessTraceEventSchema),
    // Stamped by the ML privacy pass after conversion. Collected traces
    // without it are not marketplace-ready and are rejected at escrow intake.
    privacy: privacyStampSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    // Any source-attested event implies the formatVersion 2 high-fidelity
    // envelope; a v1/summary-only document must not carry attestation.
    const hasAttestation = value.events.some(
      (event) =>
        event.timestamp !== undefined ||
        event.sourceEventId !== undefined ||
        event.parentSourceEventId !== undefined,
    )
    const hasPayload = value.events.some((event) => event.payload !== undefined)
    if ((hasAttestation || hasPayload) && value.formatVersion !== 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formatVersion"],
        message: "format_version_2_required_with_payload_or_source_attestation",
      })
    }
    if (value.eventCount !== value.events.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventCount"],
        message: "event_count_mismatch",
      })
    }
    // Duplicate source IDs break the buyer-side observation normalizer,
    // which keys observations by source ID.
    const seenSourceEventIds = new Map<string, number>()
    value.events.forEach((event, index) => {
      if (event.sourceEventId === undefined) return
      const firstSeenIndex = seenSourceEventIds.get(event.sourceEventId)
      if (firstSeenIndex === undefined) {
        seenSourceEventIds.set(event.sourceEventId, index)
        return
      }
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", index, "sourceEventId"],
        message: "duplicate_source_event_id",
      })
    })
  })
export type HarnessTraceDocument = z.infer<typeof harnessTraceDocumentSchema>

// Collection-time payload bounds. A single tool dump must not blow the escrow
// archive; oversized string leaves are truncated (with a marker), not dropped.
export const harnessPayloadPolicy = {
  maxStringBytes: 16 * 1024,
  maxSerializedBytes: 64 * 1024,
} as const

export const harnessSessionRefSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionPath: z.string().min(1),
    modifiedAt: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    projectDir: z.string().optional(),
  })
  .strict()
export type HarnessSessionRef = z.infer<typeof harnessSessionRefSchema>

// Identifies one session to convert. sessionPath alone is enough for
// harnesses that keep one file per session; store-backed harnesses (e.g. a
// single SQLite database holding every session) also need the sessionId.
export type HarnessSessionInput = Readonly<{
  sessionPath: string
  sessionId?: string
}>

export type HarnessAdapter = Readonly<{
  // Stable runtime id stamped into exported traces, e.g. "claude-code".
  runtime: string
  displayName: string
  // One-line pointer to where this harness keeps its session logs.
  logHint: string
  // Default log root on this machine, or undefined when it cannot be derived.
  defaultSourceDir: () => string | undefined
  // Enumerate sessions under a log root, newest first.
  listSessions: (sourceDir: string) => readonly HarnessSessionRef[]
  // Convert one session log into an ATF trace document.
  convertSession: (session: HarnessSessionInput) => HarnessTraceDocument
}>

export const TrajectoryAdapterErrorCode = {
  InvalidExportPath: "invalid_export_path",
  InvalidSession: "invalid_session",
  MissingSession: "missing_session",
  MissingSourceDir: "missing_source_dir",
  ServiceBootstrapFailed: "service_bootstrap_failed",
  ServiceUnsupportedPlatform: "service_unsupported_platform",
  UnknownRuntime: "unknown_runtime",
} as const

export type TrajectoryAdapterErrorCode =
  (typeof TrajectoryAdapterErrorCode)[keyof typeof TrajectoryAdapterErrorCode]

export class TrajectoryAdapterError extends Error {
  readonly code: TrajectoryAdapterErrorCode

  constructor(code: TrajectoryAdapterErrorCode, message: string) {
    super(message)
    this.name = "TrajectoryAdapterError"
    this.code = code
  }
}

const secretMarkers = ["authorization", "bearer", "api_key", "secret", "token"] as const

export const harnessDetailMaxLength = 240

// Mirrors the prototype runner's _redact plus a length cap so exported traces
// stay compact and pass the evidence unredacted-secret gate.
export const redactHarnessDetail = (detail: string): string => {
  const lowered = detail.toLowerCase()
  if (secretMarkers.some((marker) => lowered.includes(marker))) {
    return "[redacted]"
  }
  const collapsed = detail.replaceAll(/\s+/g, " ").trim()
  if (collapsed.length <= harnessDetailMaxLength) {
    return collapsed
  }
  return `${collapsed.slice(0, harnessDetailMaxLength - 1)}…`
}

// Sanitizes a payload string leaf: credential-pattern redaction (precise, so
// full observations survive) plus a per-string byte cap. Returns the string
// and whether it was truncated. Exported so the privacy pass can re-bound
// strings after PII markers are spliced in (a marker can outgrow the span it
// replaced).
export const boundedRedactedString = (value: string): { text: string; truncated: boolean } => {
  const redacted = redactCredentialSpans(value)
  if (Buffer.byteLength(redacted, "utf8") <= harnessPayloadPolicy.maxStringBytes) {
    return { text: redacted, truncated: false }
  }
  // Truncate on a UTF-8 byte boundary.
  const truncationMarker = "…[truncated]"
  const markerBytes = Buffer.byteLength(truncationMarker, "utf8")
  let end = harnessPayloadPolicy.maxStringBytes - markerBytes
  const buffer = Buffer.from(redacted, "utf8")
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) {
    end -= 1
  }
  return { text: `${buffer.subarray(0, end).toString("utf8")}${truncationMarker}`, truncated: true }
}

// Sanitizes every string leaf of an arbitrary payload value (tool
// input/output are any JSON): credential-span redaction plus the byte cap,
// via the shared string-leaf walker. Reports whether anything was truncated
// so the caller can set the marker.
const sanitizePayloadValue = (value: unknown, state: { truncated: boolean }): unknown =>
  mapStringLeaves(value, (leaf) => {
    const bounded = boundedRedactedString(leaf)
    if (bounded.truncated) {
      state.truncated = true
    }
    return bounded.text
  })

// Sanitizes a full event payload: credential-redacts and size-bounds every
// string, stamps `truncated` when any leaf was cut, and retains a truncation
// marker when aggregate structure still exceeds the serialized cap.
export const sanitizeHarnessPayload = (
  payload: HarnessEventPayload,
): HarnessEventPayload | undefined => {
  const state = { truncated: false }
  const sanitized = sanitizePayloadValue(payload, state) as HarnessEventPayload
  const withMarker: HarnessEventPayload = state.truncated
    ? { ...sanitized, truncated: true }
    : sanitized
  const parsed = harnessEventPayloadSchema.safeParse(withMarker)
  if (!parsed.success) {
    return undefined
  }
  if (
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > harnessPayloadPolicy.maxSerializedBytes
  ) {
    return { truncated: true }
  }
  return parsed.data
}
