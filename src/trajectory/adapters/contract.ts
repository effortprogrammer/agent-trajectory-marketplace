import { z } from "zod"

// Harness adapters convert coding-harness session logs that already exist on
// the seller's machine into ATF trace documents. Traces produced this way use
// status "collected" (vs "instrumented" for the Python prototype demo).
export const harnessCollectedStatus = "collected" as const

export const harnessTraceEventSchema = z
  .object({
    kind: z.string().min(1),
    name: z.string().min(1),
    detail: z.string(),
  })
  .strict()
export type HarnessTraceEvent = z.infer<typeof harnessTraceEventSchema>

export const harnessTraceDocumentSchema = z
  .object({
    runtime: z.string().min(1),
    status: z.literal(harnessCollectedStatus),
    eventCount: z.number().int().nonnegative(),
    events: z.array(harnessTraceEventSchema),
  })
  .strict()
export type HarnessTraceDocument = z.infer<typeof harnessTraceDocumentSchema>

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
