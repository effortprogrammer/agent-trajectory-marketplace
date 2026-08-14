import { isAbsolute } from "node:path"

import { z } from "zod"

import { datasetArchivePolicy } from "./archive-contract"
import { sanitizedArtifactDigest } from "./dataset-archive"
import { MarketplaceError } from "./error"
import { FixtureReadError, readFixtureFile } from "./fixture-reader"
import { parseAdmissionJson } from "./json-preflight"
import { fullSelectorSchema, sessionSummarySchema, traceHashSchema } from "./session-contract"
import type { FrozenTrace, SessionSummary } from "./session-contract"
import { buildSessionListItem } from "./session-report"
import { boundedRedactedString, harnessTraceDocumentSchema } from "../trajectory/adapters/contract"

const maximumSelectionBytes = 1024 * 1024

const selectionTraceSchema = z
  .object({
    artifactByteCount: z.number().int().positive(),
    artifactSha256: traceHashSchema,
    byteCount: z.number().int().positive(),
    earliestTimestamp: z.string().min(1).max(64),
    eventCount: z.number().int().nonnegative(),
    runtime: z.string().min(1),
    runtimeAttribution: z.literal("operator_declared").optional(),
    selector: fullSelectorSchema,
    sha256: traceHashSchema,
    summary: sessionSummarySchema,
  })
  .strict()

const selectionDocumentSchema = z
  .object({
    root: z.string().min(1).refine(isAbsolute),
    schemaVersion: z.literal(1),
    traces: z.array(selectionTraceSchema).min(1).max(datasetArchivePolicy.maxTraces),
  })
  .strict()
  .superRefine((value, context) => {
    const selectors = new Set<string>()
    for (const [index, trace] of value.traces.entries()) {
      if (selectors.has(trace.selector)) {
        context.addIssue({ code: "custom", path: ["traces", index, "selector"], message: "duplicate selector" })
      }
      selectors.add(trace.selector)
      if (trace.runtime === "pi" && trace.runtimeAttribution !== "operator_declared") {
        context.addIssue({ code: "custom", path: ["traces", index, "runtimeAttribution"], message: "pi attribution required" })
      }
      if (trace.runtime !== "pi" && trace.runtimeAttribution !== undefined) {
        context.addIssue({ code: "custom", path: ["traces", index, "runtimeAttribution"], message: "unexpected runtime attribution" })
      }
    }
  })

export type SelectionTrace = Readonly<{
  artifactByteCount: number
  artifactSha256: FrozenTrace["hash"]
  byteCount: number
  earliestTimestamp: string
  eventCount: number
  runtime: string
  runtimeAttribution?: "operator_declared"
  selector: FrozenTrace["selector"]
  sha256: FrozenTrace["hash"]
  summary: SessionSummary
}>

export type SelectionDocument = Readonly<{
  readonly root: string
  readonly schemaVersion: 1
  readonly traces: readonly SelectionTrace[]
}>

export class SelectionContractError extends Error {
  public readonly name = "SelectionContractError"
  public constructor(public readonly code: "invalid_selection") { super(code) }
}

const invalid = (): never => {
  throw new SelectionContractError("invalid_selection")
}

const sortedTraces = (traces: readonly SelectionTrace[]): readonly SelectionTrace[] =>
  [...traces].sort((left, right) => (left.selector < right.selector ? -1 : left.selector > right.selector ? 1 : 0))

const summaryForTrace = (trace: FrozenTrace): SessionSummary => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(trace.bytes)
  const document = harnessTraceDocumentSchema.parse(JSON.parse(text))
  return buildSessionListItem({ frozenTrace: trace, document }).summary
}

export const selectionDocumentFromTraces = (root: string, traces: readonly FrozenTrace[]): SelectionDocument =>
  Object.freeze({
    root,
    schemaVersion: 1,
    traces: Object.freeze(sortedTraces(traces.map((trace) => {
      const artifact = sanitizedArtifactDigest(trace.bytes)
      return Object.freeze({
        artifactByteCount: artifact.byteCount,
        artifactSha256: traceHashSchema.parse(artifact.sha256),
        byteCount: trace.byteCount,
        earliestTimestamp: trace.earliestTimestamp,
        eventCount: trace.eventCount,
        runtime: boundedRedactedString(trace.runtime).text,
        ...(trace.runtimeAttribution === undefined
          ? {}
          : { runtimeAttribution: trace.runtimeAttribution }),
        selector: trace.selector,
        sha256: trace.hash,
        summary: summaryForTrace(trace),
      })
    }))),
  })

export const encodeSelectionDocument = (input: unknown): Buffer => {
  const parsed = selectionDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid()
  return Buffer.from(`${JSON.stringify({ ...parsed.data, traces: sortedTraces(parsed.data.traces) }, null, 2)}\n`, "utf8")
}

export const parseSelectionDocument = (bytes: Buffer): SelectionDocument => {
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumSelectionBytes) return invalid()
  const input = parseAdmissionJson(bytes)
  if (input === undefined) return invalid()
  const parsed = selectionDocumentSchema.safeParse(input)
  if (!parsed.success) return invalid()
  return parsed.data
}

export const readSelectionDocument = (path: string): SelectionDocument => {
  try {
    return parseSelectionDocument(readFixtureFile(path, maximumSelectionBytes))
  } catch (error) {
    if (error instanceof SelectionContractError || error instanceof FixtureReadError) {
      throw new MarketplaceError("invalid_bundle_request")
    }
    throw error
  }
}
