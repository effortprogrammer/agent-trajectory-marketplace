import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { resolveReadableProjectPath, resolveWritableProjectPath } from "./path-safety"

const requiredEventKinds = [
  "function_enter",
  "function_exit",
  "llm_call",
  "tool_call",
  "verification",
] as const

const secretMarkers = ["authorization", "bearer", "api_key", "secret", "token"] as const

const traceEventSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  detail: z.string(),
})

const traceSchema = z.object({
  runtime: z.string().min(1),
  status: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
  events: z.array(traceEventSchema),
})

const inspectInputSchema = z.object({
  tracePath: z.string().min(1),
})

const bundleInputSchema = inspectInputSchema.extend({
  outDir: z.string().min(1),
})

type TraceEvent = z.infer<typeof traceEventSchema>
type TraceDocument = z.infer<typeof traceSchema>

type RedactedFinding = Readonly<{
  kind: string
  name: string
}>

export type InspectTraceResult = Readonly<{
  valid: boolean
  marketplaceReady: boolean
  runtime: string
  status: string
  eventCount: number
  tracePath: string
  eventKinds: readonly string[]
  requiredKinds: readonly string[]
  redactedFindings: readonly RedactedFinding[]
  checks: Readonly<{
    eventCountMatches: boolean
    instrumented: boolean
    redactionClean: boolean
    requiredKindsPresent: boolean
  }>
}>

const TrajectoryEvidenceErrorCode = {
  EventCountMismatch: "event_count_mismatch",
  InvalidOutputPath: "invalid_output_path",
  InvalidTraceJson: "invalid_trace_json",
  InvalidTracePath: "invalid_trace_path",
  InvalidTraceSchema: "invalid_trace_schema",
  MissingTrace: "missing_trace",
  TraceNotMarketplaceReady: "trace_not_marketplace_ready",
  UnredactedSecret: "unredacted_secret",
} as const

type TrajectoryEvidenceErrorCode =
  (typeof TrajectoryEvidenceErrorCode)[keyof typeof TrajectoryEvidenceErrorCode]

export class TrajectoryEvidenceError extends Error {
  readonly code: TrajectoryEvidenceErrorCode

  constructor(code: TrajectoryEvidenceErrorCode, message: string) {
    super(message)
    this.name = "TrajectoryEvidenceError"
    this.code = code
  }
}

const throwPathError = (code: TrajectoryEvidenceErrorCode, path: string): never => {
  throw new TrajectoryEvidenceError(code, `${code}: ${path}`)
}

const readTraceDocument = (tracePath: string): TraceDocument => {
  if (!existsSync(tracePath)) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.MissingTrace,
      `missing_trace: ${tracePath}`,
    )
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(readFileSync(tracePath, "utf8"))
  } catch {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.InvalidTraceJson,
      `invalid_trace_json: ${tracePath}`,
    )
  }

  const parsedTrace = traceSchema.safeParse(parsedJson)
  if (!parsedTrace.success) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.InvalidTraceSchema,
      `invalid_trace_schema: ${tracePath}`,
    )
  }

  return parsedTrace.data
}

const countKinds = (events: readonly TraceEvent[]) => {
  const counts: Record<string, number> = {}
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1
  }
  return counts
}

const isRedacted = (detail: string) => detail.trim() === "[redacted]"

const containsSecretMarker = (detail: string) => {
  const normalizedDetail = detail.toLowerCase()
  return secretMarkers.some((marker) => normalizedDetail.includes(marker))
}

const collectRedactedFindings = (events: readonly TraceEvent[]) =>
  events
    .filter((event) => isRedacted(event.detail))
    .map((event) => ({
      kind: event.kind,
      name: event.name,
    }))

const collectUnredactedSecrets = (events: readonly TraceEvent[]) =>
  events.filter((event) => !isRedacted(event.detail) && containsSecretMarker(event.detail))

const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

const assertUsableBundleDir = (bundleDir: string) => {
  if (!existsSync(bundleDir)) {
    return
  }

  if (!statSync(bundleDir).isDirectory()) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.InvalidOutputPath,
      `invalid_output_path: ${bundleDir}`,
    )
  }
}

export const inspectTraceFile = (tracePath: string): InspectTraceResult => {
  const trace = readTraceDocument(tracePath)

  if (trace.eventCount !== trace.events.length) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.EventCountMismatch,
      `event_count_mismatch: declared ${trace.eventCount}, found ${trace.events.length}`,
    )
  }

  const leakedSecrets = collectUnredactedSecrets(trace.events)
  if (leakedSecrets.length > 0) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.UnredactedSecret,
      `unredacted_secret: ${leakedSecrets.map((event) => event.name).join(", ")}`,
    )
  }

  const kindCounts = countKinds(trace.events)
  const eventKinds = Object.keys(kindCounts).sort()
  const requiredKinds = requiredEventKinds.filter((kind) => kindCounts[kind] !== undefined)
  const checks = {
    eventCountMatches: true,
    instrumented: trace.status === "instrumented",
    redactionClean: true,
    requiredKindsPresent: requiredKinds.length === requiredEventKinds.length,
  }

  return {
    valid: true,
    marketplaceReady: checks.instrumented && checks.requiredKindsPresent,
    runtime: trace.runtime,
    status: trace.status,
    eventCount: trace.eventCount,
    tracePath,
    eventKinds,
    requiredKinds,
    redactedFindings: collectRedactedFindings(trace.events),
    checks,
  }
}

export const inspectTrace = (input: { readonly tracePath: string }): InspectTraceResult => {
  const parsed = inspectInputSchema.parse(input)
  const tracePath = resolveReadableProjectPath({
    inputPath: parsed.tracePath,
    code: TrajectoryEvidenceErrorCode.InvalidTracePath,
    throwPathError,
  })

  return inspectTraceFile(tracePath)
}

export const bundleTrace = (input: { readonly tracePath: string; readonly outDir: string }) => {
  const parsed = bundleInputSchema.parse(input)
  const inspect = inspectTrace({ tracePath: parsed.tracePath })

  if (!inspect.marketplaceReady) {
    throw new TrajectoryEvidenceError(
      TrajectoryEvidenceErrorCode.TraceNotMarketplaceReady,
      `trace_not_marketplace_ready: ${inspect.tracePath}`,
    )
  }

  const bundleDir = resolveWritableProjectPath({
    inputPath: parsed.outDir,
    code: TrajectoryEvidenceErrorCode.InvalidOutputPath,
    throwPathError,
  })
  const bundledTracePath = join(bundleDir, "trace.atf.json")
  const manifestPath = join(bundleDir, "manifest.json")
  const cleanupOnFailure = !existsSync(bundleDir)

  assertUsableBundleDir(bundleDir)

  try {
    mkdirSync(bundleDir, { recursive: true })
    copyFileSync(inspect.tracePath, bundledTracePath)

    const manifest = {
      schemaVersion: 1,
      kind: "trajectory-evidence-bundle",
      createdAt: new Date().toISOString(),
      sourceTracePath: inspect.tracePath,
      runtime: inspect.runtime,
      status: inspect.status,
      eventKinds: inspect.eventKinds,
      trace: {
        file: "trace.atf.json",
        sha256: sha256File(bundledTracePath),
        eventCount: inspect.eventCount,
      },
      checks: {
        marketplaceReady: inspect.marketplaceReady,
        requiredKindsPresent: inspect.checks.requiredKindsPresent,
        redactionClean: inspect.checks.redactionClean,
      },
    }

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  } catch (error) {
    if (cleanupOnFailure) {
      rmSync(bundleDir, { force: true, recursive: true })
    }
    throw error
  }

  return {
    bundleDir,
    manifestPath,
    tracePath: bundledTracePath,
    marketplaceReady: inspect.marketplaceReady,
    eventCount: inspect.eventCount,
  }
}
