import { Buffer } from "node:buffer"
import { createHash, type Hash } from "node:crypto"
import { z } from "zod"

import { deriveFunctionDepth } from "./metrics-function-depth"
import {
  type TrajectoryObservation,
  type TrajectoryObservationEventClass,
  type TrajectoryObservationSet,
  trajectoryObservationEventClasses,
  trajectoryObservationNormalizerVersion,
  trajectoryObservationSetSchema,
} from "./observation"

export const trajectoryMetricSetVersion = "trajectory-metrics-v2" as const
export const trajectoryMetricPolicy = {
  maxResults: 7,
  maxValuesPerResult: trajectoryObservationEventClasses.length,
  maxDimensionsPerValue: 1,
  maxLimitationsPerResult: 2,
  maxSerializedBytes: 24 * 1024,
} as const
export const trajectoryMetricIds = {
  totalEvents: "trajectory.events.total",
  kindDistribution: "trajectory.events.kind_distribution",
  toolCallCount: "trajectory.tools.calls.total",
  matchedToolResultCount: "trajectory.tools.results.matched",
  unmatchedToolResultCount: "trajectory.tools.results.unmatched",
  toolErrorCount: "trajectory.tools.results.errors",
  maxFunctionDepth: "trajectory.functions.max_depth",
} as const

export type TrajectoryMetricId = (typeof trajectoryMetricIds)[keyof typeof trajectoryMetricIds]
export type TrajectoryMetricLimitationCode =
  | "analysis_coverage_partial"
  | "analysis_coverage_unavailable"
  | "function_boundary_direction_unavailable"
  | "metric_values_truncated"
  | "tool_error_availability_unavailable"
  | "tool_linkage_unavailable"

// biome-ignore format: Stable definition rows stay directly comparable across versions.
const metricSpecs = [
  { id: trajectoryMetricIds.totalEvents, unit: "events", operation: "count", maxValues: 1, parameters: [] },
  { id: trajectoryMetricIds.kindDistribution, unit: "events", operation: "grouped_count", maxValues: trajectoryObservationEventClasses.length, parameters: [{ name: "group_by", value: "event_class" }] },
  { id: trajectoryMetricIds.toolCallCount, unit: "events", operation: "count", maxValues: 1, parameters: [{ name: "event_class", value: "tool_call" }] },
  { id: trajectoryMetricIds.matchedToolResultCount, unit: "events", operation: "count", maxValues: 1, parameters: [{ name: "event_class", value: "tool_result" }, { name: "link_status", value: "matched" }] },
  { id: trajectoryMetricIds.unmatchedToolResultCount, unit: "events", operation: "count", maxValues: 1, parameters: [{ name: "event_class", value: "tool_result" }, { name: "link_status", value: "invalid" }] },
  { id: trajectoryMetricIds.toolErrorCount, unit: "events", operation: "count", maxValues: 1, parameters: [{ name: "event_class", value: "tool_result" }, { name: "error_outcome", value: "error" }] },
  { id: trajectoryMetricIds.maxFunctionDepth, unit: "levels", operation: "max", maxValues: 1, parameters: [{ name: "event_class", value: "step" }, { name: "required_fact", value: "function_boundary_direction" }, { name: "reset_by", value: "artifact_source_identity" }, { name: "unbalanced_policy", value: "unavailable_or_known_lower_bound" }] },
] as const

const bytewiseCompare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
// biome-ignore format: Parameters are copied, byte-sorted, and frozen as one operation.
const freezeParameters = (parameters: readonly Readonly<{ name: string; value: string }>[]) =>
  Object.freeze([...parameters].sort((left, right) => bytewiseCompare(left.name, right.name)).map((parameter) => Object.freeze({ ...parameter })))
export const trajectoryMetricDefinitions = Object.freeze(
  metricSpecs.map((spec) =>
    Object.freeze({
      id: spec.id,
      version: 1 as const,
      unit: spec.unit,
      aggregation: Object.freeze({
        scope: "observation_set" as const,
        operation: spec.operation,
        parameters: freezeParameters(spec.parameters),
      }),
      missingValue: Object.freeze({
        unavailable: "omit_values" as const,
        partial: "known_lower_bound_with_limitation" as const,
      }),
      rounding: Object.freeze({ mode: "none" as const }),
      truncation: Object.freeze({
        maxValues: spec.maxValues,
        ordering: "utf8_bytewise_ascending" as const,
        overflow: "partial" as const,
      }),
      authority: "marketplace_derived_from_normalized_observations" as const,
    }),
  ),
)
export type TrajectoryMetricDefinition = (typeof trajectoryMetricDefinitions)[number]
// biome-ignore format: The closed coverage union is intentionally compact.
export const trajectoryAnalysisCoverageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete") }).strict(),
  z.object({ status: z.literal("partial"), reason: z.literal("observation_limit_reached") }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.literal("normalized_observations_unavailable") }).strict(),
])
export type TrajectoryAnalysisCoverage =
  | Readonly<{ status: "complete" }>
  | Readonly<{ status: "partial"; reason: "observation_limit_reached" }>
  | Readonly<{ status: "unavailable"; reason: "normalized_observations_unavailable" }>
// biome-ignore format: The immutable default is a single literal.
export const completeTrajectoryAnalysisCoverage: TrajectoryAnalysisCoverage = Object.freeze({ status: "complete" })

export type TrajectoryMetricDatum = Readonly<{
  dimensions: readonly Readonly<{ name: "event_class"; value: TrajectoryObservationEventClass }>[]
  value: number
}>
export type TrajectoryMetricLimitation = Readonly<{
  code: TrajectoryMetricLimitationCode
  unavailableCount?: number
}>
// biome-ignore format: The result union makes unavailable values structurally absent.
type MetricResult =
  | Readonly<{ metricId: TrajectoryMetricId; status: "available" | "partial"; values: readonly TrajectoryMetricDatum[]; limitations: readonly TrajectoryMetricLimitation[] }>
  | Readonly<{ metricId: TrajectoryMetricId; status: "unavailable"; limitations: readonly TrajectoryMetricLimitation[] }>
type MetricDraft = Readonly<{
  metricId: TrajectoryMetricId
  status: "available" | "partial" | "unavailable"
  values?: readonly TrajectoryMetricDatum[]
  limitations: readonly TrajectoryMetricLimitation[]
}>

const updateHashPart = (hash: Hash, value: string): void => {
  const bytes = Buffer.from(value, "utf8")
  hash.update(`${bytes.byteLength}:`, "utf8").update(bytes)
}
const digestParts = (parts: readonly string[]): string => {
  const hash = createHash("sha256")
  for (const part of parts) updateHashPart(hash, part)
  return hash.digest("hex")
}
const commitment = (digest: string): string => `sha256:${digest.slice(0, 16)}`
// biome-ignore format: Keeping the lookup signature on one line preserves the module size ceiling.
const definitionFor = (metricId: TrajectoryMetricId): (typeof trajectoryMetricDefinitions)[number] => {
  const definition = trajectoryMetricDefinitions.find(({ id }) => id === metricId)
  if (definition === undefined) throw new TypeError("unknown_trajectory_metric_definition")
  return definition
}
const scalar = (value: number): readonly TrajectoryMetricDatum[] =>
  Object.freeze([Object.freeze({ dimensions: Object.freeze([]), value })])
const limitation = (
  code: TrajectoryMetricLimitationCode,
  unavailableCount?: number,
): TrajectoryMetricLimitation =>
  Object.freeze({ code, ...(unavailableCount === undefined ? {} : { unavailableCount }) })

// biome-ignore format: Cross-field consistency is kept together as one boundary predicate.
const factsAreConsistent = (observation: TrajectoryObservation): boolean => {
  const toolEvent = observation.eventClass === "tool_call" || observation.eventClass === "tool_result"
  if (toolEvent === (observation.toolUseLink.status === "not_applicable")) return false
  if (observation.eventClass === "tool_result" && observation.error.availability === "not_applicable") return false
  if (observation.eventClass === "error") {
    if (observation.error.availability !== "available" || observation.error.outcome !== "error") return false
  } else if (observation.eventClass !== "tool_result" && observation.error.availability !== "not_applicable") return false
  return observation.eventClass === "verification"
    ? observation.verification.availability !== "not_applicable"
    : observation.verification.availability === "not_applicable"
}
const sourceDigestFor = (set: TrajectoryObservationSet): string => {
  const hash = createHash("sha256")
  updateHashPart(hash, JSON.stringify([set.schemaVersion, set.normalizerVersion, set.summary]))
  for (const observation of set.observations) updateHashPart(hash, JSON.stringify(observation))
  return hash.digest("hex")
}
// biome-ignore format: The ternary mirrors the available/partial/unavailable result union.
const incompleteCount = (
  metricId: TrajectoryMetricId,
  value: number,
  applicableCount: number,
  unavailableCount: number,
  code: TrajectoryMetricLimitationCode,
): MetricDraft =>
  unavailableCount === 0
    ? { metricId, status: "available", values: scalar(value), limitations: [] }
    : applicableCount === unavailableCount
      ? { metricId, status: "unavailable", limitations: [limitation(code, unavailableCount)] }
      : { metricId, status: "partial", values: scalar(value), limitations: [limitation(code, unavailableCount)] }
// biome-ignore format: Bounds and coverage are applied atomically to one result draft.
const boundDraft = (draft: MetricDraft, coverage: TrajectoryAnalysisCoverage): MetricDraft => {
  if (coverage.status === "unavailable") {
    return { metricId: draft.metricId, status: "unavailable", limitations: [limitation("analysis_coverage_unavailable")] }
  }
  const values = draft.values ?? []
  const maxValues = definitionFor(draft.metricId).truncation.maxValues
  const limitations = [...draft.limitations]
  if (values.length > maxValues) limitations.push(limitation("metric_values_truncated"))
  if (coverage.status === "partial") limitations.push(limitation("analysis_coverage_partial"))
  const unique = [...new Map(limitations.map((item) => [item.code, item])).values()]
    .sort((left, right) => bytewiseCompare(left.code, right.code))
    .slice(0, trajectoryMetricPolicy.maxLimitationsPerResult)
  if (draft.status === "unavailable") return { ...draft, limitations: unique }
  return { metricId: draft.metricId, status: unique.length === 0 ? "available" : "partial", values: values.slice(0, maxValues), limitations: unique }
}
// biome-ignore format: Deep freezing is one compact read-model construction step.
const finalizeDraft = (draft: MetricDraft): MetricResult => {
  const limitations = Object.freeze(draft.limitations.map((item) => Object.freeze({ ...item })))
  if (draft.status === "unavailable") return Object.freeze({ metricId: draft.metricId, status: "unavailable", limitations })
  const values = Object.freeze((draft.values ?? []).map((datum) => Object.freeze({ dimensions: Object.freeze(datum.dimensions.map((dimension) => Object.freeze({ ...dimension }))), value: datum.value })))
  return Object.freeze({ metricId: draft.metricId, status: draft.status, values, limitations })
}

// biome-ignore format: The pure derivation stays reviewable as one bounded pipeline.
export const deriveTrajectoryMetrics = (
  observationSetInput: unknown,
  coverageInput: unknown = completeTrajectoryAnalysisCoverage,
) => {
  const coverageResult = trajectoryAnalysisCoverageSchema.safeParse(coverageInput)
  if (!coverageResult.success) throw new TypeError("invalid_trajectory_analysis_coverage")
  const coverage = Object.freeze({ ...coverageResult.data })
  const parsed = coverage.status === "unavailable" ? undefined : trajectoryObservationSetSchema.safeParse(observationSetInput)
  if (parsed !== undefined && !parsed.success) throw new TypeError("invalid_normalized_observation_set")
  const set = parsed?.data
  if (set !== undefined && !set.observations.every(factsAreConsistent)) throw new TypeError("inconsistent_normalized_observation_set")
  const sourceDigest = set === undefined
    ? digestParts([trajectoryMetricSetVersion, coverage.status === "unavailable" ? coverage.reason : "missing"])
    : sourceDigestFor(set)
  const functionDepth = deriveFunctionDepth(set?.observations ?? [])
  const kindCounts = new Map<TrajectoryObservationEventClass, number>()
  // biome-ignore format: Mutable counters are one bounded derivation accumulator.
  const counts = { toolCalls: 0, toolResults: 0, matchedResults: 0, unmatchedResults: 0, unavailableLinks: 0, toolErrors: 0, unavailableErrors: 0 }
  for (const observation of set?.observations ?? []) {
    kindCounts.set(observation.eventClass, (kindCounts.get(observation.eventClass) ?? 0) + 1)
    if (observation.eventClass === "tool_call") counts.toolCalls += 1
    if (observation.eventClass === "tool_result") {
      counts.toolResults += 1
      if (observation.toolUseLink.status === "matched") counts.matchedResults += 1
      else if (observation.toolUseLink.status === "invalid") counts.unmatchedResults += 1
      else counts.unavailableLinks += 1
      if (observation.error.availability === "unavailable") counts.unavailableErrors += 1
      else if (observation.error.availability === "available" && observation.error.outcome === "error") counts.toolErrors += 1
    }
  }
  const kindValues = [...kindCounts.entries()]
    .sort(([left], [right]) => bytewiseCompare(left, right))
    .map(([eventClass, value]) => Object.freeze({ dimensions: Object.freeze([Object.freeze({ name: "event_class" as const, value: eventClass })]), value }))
  // biome-ignore format: The closed depth result maps directly into the metric-result union.
  const functionDepthDraft: MetricDraft = functionDepth.status === "unavailable" ? { metricId: trajectoryMetricIds.maxFunctionDepth, status: "unavailable", limitations: [limitation("function_boundary_direction_unavailable", functionDepth.unbalancedCount)] } : { metricId: trajectoryMetricIds.maxFunctionDepth, status: functionDepth.status, values: scalar(functionDepth.depth), limitations: functionDepth.status === "partial" ? [limitation("function_boundary_direction_unavailable", functionDepth.unbalancedCount)] : [] }
  // biome-ignore format: Stable result order matches the public definition registry.
  const drafts: readonly MetricDraft[] = [
    { metricId: trajectoryMetricIds.totalEvents, status: "available", values: scalar(set?.summary.observationCount ?? 0), limitations: [] },
    { metricId: trajectoryMetricIds.kindDistribution, status: "available", values: kindValues, limitations: [] },
    { metricId: trajectoryMetricIds.toolCallCount, status: "available", values: scalar(counts.toolCalls), limitations: [] },
    incompleteCount(trajectoryMetricIds.matchedToolResultCount, counts.matchedResults, counts.toolResults, counts.unavailableLinks, "tool_linkage_unavailable"),
    incompleteCount(trajectoryMetricIds.unmatchedToolResultCount, counts.unmatchedResults, counts.toolResults, counts.unavailableLinks, "tool_linkage_unavailable"),
    incompleteCount(trajectoryMetricIds.toolErrorCount, counts.toolErrors, counts.toolResults, counts.unavailableErrors, "tool_error_availability_unavailable"),
    functionDepthDraft,
  ]
  const results = Object.freeze(drafts.map((draft) => finalizeDraft(boundDraft(draft, coverage))))
  const limitations = Object.freeze([...new Set(results.flatMap((result) => result.limitations.map(({ code }) => code)))].sort(bytewiseCompare).slice(0, trajectoryMetricPolicy.maxResults))
  const sourceSummary = set === undefined ? undefined : Object.freeze({ artifactCount: set.summary.artifactCount, observationCount: set.summary.observationCount, atfVersionCounts: Object.freeze({ ...set.summary.atfVersionCounts }) })
  const metricSet = Object.freeze({
    metricSetVersion: trajectoryMetricSetVersion,
    normalizerVersion: trajectoryObservationNormalizerVersion,
    coverage,
    ...(sourceSummary === undefined ? {} : { sourceSummary, sourceSetCommitment: commitment(sourceDigest) }),
    results,
    limitations,
    derivationHash: commitment(digestParts([sourceDigest, trajectoryMetricSetVersion, JSON.stringify(coverage), JSON.stringify(results)])),
  })
  if (Buffer.byteLength(JSON.stringify(metricSet)) > trajectoryMetricPolicy.maxSerializedBytes) throw new TypeError("trajectory_metric_output_limit_exceeded")
  return metricSet
}

export type TrajectoryMetricSet = ReturnType<typeof deriveTrajectoryMetrics>
export type TrajectoryMetricResult = TrajectoryMetricSet["results"][number]
