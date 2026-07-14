import { z } from "zod"

import { redactCredentialSpans } from "../credential-redaction"
import { privacyStampSchema } from "../privacy/contract"

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
    payload: harnessEventPayloadSchema.optional(),
  })
  .strict()
export type HarnessTraceEvent = z.infer<typeof harnessTraceEventSchema>

export const harnessTraceDocumentSchema = z
  .object({
    runtime: z.string().min(1),
    status: z.literal(harnessCollectedStatus),
    // Omitted or 1 = summary-only (no payloads); 2 = fidelity-optional events.
    formatVersion: z.literal(2).optional(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(harnessTraceEventSchema),
    // Stamped by the ML privacy pass after conversion. Collected traces
    // without it are not marketplace-ready and are rejected at escrow intake.
    privacy: privacyStampSchema.optional(),
  })
  .strict()
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
  let end = harnessPayloadPolicy.maxStringBytes
  const buffer = Buffer.from(redacted, "utf8")
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) {
    end -= 1
  }
  return { text: `${buffer.subarray(0, end).toString("utf8")}…[truncated]`, truncated: true }
}

// Recursively sanitizes an arbitrary payload value (tool input/output are any
// JSON): redacts credential spans in every string leaf and caps string sizes.
// Reports whether anything was truncated so the caller can set the marker.
const sanitizePayloadValue = (value: unknown, state: { truncated: boolean }): unknown => {
  if (typeof value === "string") {
    const bounded = boundedRedactedString(value)
    if (bounded.truncated) {
      state.truncated = true
    }
    return bounded.text
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayloadValue(item, state))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizePayloadValue(item, state)]),
    )
  }
  return value
}

// Sanitizes a full event payload: credential-redacts and size-bounds every
// string, stamps `truncated` when any leaf was cut, and drops the whole
// payload if it still exceeds the serialized cap after per-string bounding
// (a defensive fallback — should not happen with the per-string cap).
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
    return undefined
  }
  return parsed.data
}
