import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"

import {
  deriveTrajectoryMetrics,
  trajectoryMetricDefinitions,
  trajectoryMetricIds,
  trajectoryMetricPolicy,
  trajectoryMetricSetVersion,
} from "../src/trajectory/metrics"
import { normalizeAtfObservations } from "../src/trajectory/observation"

const archiveSha256 = "a".repeat(64)

const artifact = (artifactPath: string, document: unknown) => {
  const sourceBytes = Buffer.from(JSON.stringify(document), "utf8")
  return {
    artifactPath,
    artifactSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    sourceBytes,
  }
}

const deterministicFixture = () =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: [
      artifact("traces/metrics.atf.json", {
        runtime: "private-runtime",
        status: "collected",
        formatVersion: 2,
        eventCount: 13,
        events: [
          { kind: "session_start", name: "session", detail: "PRIVATE_DETAIL" },
          { kind: "function_enter", name: "outer", detail: "PRIVATE_FUNCTION" },
          { kind: "function_enter", name: "inner", detail: "PRIVATE_INNER_FUNCTION" },
          {
            kind: "tool_call",
            name: "Read",
            detail: "PRIVATE_CALL",
            payload: { toolUseId: "link-a", input: { path: "PRIVATE_INPUT" } },
          },
          {
            kind: "tool_result",
            name: "Read",
            detail: "PRIVATE_RESULT",
            payload: { toolUseId: "link-a", isError: false, output: "PRIVATE_OUTPUT" },
          },
          {
            kind: "tool_result",
            name: "Write",
            detail: "PRIVATE_ERROR_RESULT",
            payload: { toolUseId: "orphan-result", isError: true, output: "PRIVATE_STDERR" },
          },
          {
            kind: "verification",
            name: "source-check-a",
            detail: "PRIVATE_ASSERTION_A",
            payload: { label: "PRIVATE_LABEL_A", passed: true },
          },
          {
            kind: "verification",
            name: "source-check-b",
            detail: "PRIVATE_ASSERTION_B",
            payload: { label: "PRIVATE_LABEL_B", passed: false },
          },
          { kind: "llm_call", name: "model", detail: "PRIVATE_PROMPT" },
          { kind: "runtime_error", name: "runtime", detail: "PRIVATE_STDOUT" },
          { kind: "custom", name: "custom", detail: "PRIVATE_OTHER" },
          { kind: "function_exit", name: "inner", detail: "PRIVATE_INNER_EXIT" },
          { kind: "function_exit", name: "outer", detail: "PRIVATE_EXIT" },
        ],
      }),
    ],
  })

const functionDepthFixture = (eventGroups: readonly (readonly unknown[])[]) =>
  normalizeAtfObservations({
    archiveSha256,
    artifacts: eventGroups.map((events, index) =>
      artifact(`traces/depth-${index}.atf.json`, {
        runtime: "private-runtime",
        status: "instrumented",
        eventCount: events.length,
        events,
      }),
    ),
  })

const resultFor = (metrics: ReturnType<typeof deriveTrajectoryMetrics>, metricId: string) => {
  const result = metrics.results.find((candidate) => candidate.metricId === metricId)
  if (result === undefined) throw new TypeError(`missing metric result: ${metricId}`)
  return result
}

const scalarValue = (
  metrics: ReturnType<typeof deriveTrajectoryMetrics>,
  metricId: string,
): number => {
  const result = resultFor(metrics, metricId)
  if (result.status === "unavailable") {
    throw new TypeError(`metric is unavailable: ${metricId}`)
  }
  const datum = result.values[0]
  if (datum === undefined) throw new TypeError(`metric has no scalar value: ${metricId}`)
  return datum.value
}

const captureError = (action: () => unknown): Error => {
  try {
    action()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new TypeError("expected an error")
}

describe("trajectory metrics", () => {
  test("publishes stable reproducible metric definitions", () => {
    // Given: the public metric-definition registry.
    const definitions = trajectoryMetricDefinitions

    // When: consumers inspect definition identity and derivation policy.
    const ids = definitions.map((definition) => definition.id)

    // Then: every initial metric has a unique stable contract with explicit semantics.
    expect(trajectoryMetricSetVersion).toBe("trajectory-metrics-v2")
    expect(ids).toEqual(Object.values(trajectoryMetricIds))
    expect(new Set(ids).size).toBe(ids.length)
    for (const definition of definitions) {
      const parameterNames = definition.aggregation.parameters.map(({ name }) => name)
      const bytewiseNames = [...parameterNames].sort((left, right) =>
        Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
      )
      expect(definition.version).toBe(1)
      expect(definition.aggregation.scope).toBe("observation_set")
      expect(parameterNames).toEqual(bytewiseNames)
      expect(definition.missingValue.unavailable).toBe("omit_values")
      expect(definition.missingValue.partial).toBe("known_lower_bound_with_limitation")
      expect(definition.rounding).toEqual({ mode: "none" })
      expect(definition.truncation.overflow).toBe("partial")
      expect(definition.truncation.ordering).toBe("utf8_bytewise_ascending")
      expect(definition.authority).toBe("marketplace_derived_from_normalized_observations")
    }
  })

  test("derives deterministic metric values", () => {
    // Given: one normalized v2 observation set containing every initial event class.
    const normalized = deterministicFixture()

    // When: metrics are independently re-derived from the same normalized observations.
    const first = deriveTrajectoryMetrics(normalized)
    const second = deriveTrajectoryMetrics(normalized)

    // Then: values, bytewise dimension order, and commitments repeat exactly.
    expect(first).toEqual(second)
    expect(first.derivationHash).toMatch(/^sha256:[a-f0-9]{16}$/)
    expect(first.sourceSetCommitment).toMatch(/^sha256:[a-f0-9]{16}$/)
    expect(scalarValue(first, trajectoryMetricIds.totalEvents)).toBe(13)
    expect(scalarValue(first, trajectoryMetricIds.toolCallCount)).toBe(1)
    expect(scalarValue(first, trajectoryMetricIds.matchedToolResultCount)).toBe(1)
    expect(scalarValue(first, trajectoryMetricIds.unmatchedToolResultCount)).toBe(1)
    expect(scalarValue(first, trajectoryMetricIds.toolErrorCount)).toBe(1)
    expect(first.results.map((result) => result.metricId)).not.toContain(
      "trajectory.verification.labels.total",
    )
    expect(first.results.map((result) => result.metricId)).not.toContain(
      "trajectory.verification.passed.total",
    )
    expect(first.results.map((result) => result.metricId)).not.toContain(
      "trajectory.verification.failed.total",
    )

    const distribution = resultFor(first, trajectoryMetricIds.kindDistribution)
    if (distribution.status === "unavailable") throw new TypeError("expected kind distribution")
    expect(distribution.values).toEqual([
      { dimensions: [{ name: "event_class", value: "error" }], value: 1 },
      { dimensions: [{ name: "event_class", value: "llm" }], value: 1 },
      { dimensions: [{ name: "event_class", value: "other" }], value: 1 },
      { dimensions: [{ name: "event_class", value: "session" }], value: 1 },
      { dimensions: [{ name: "event_class", value: "step" }], value: 4 },
      { dimensions: [{ name: "event_class", value: "tool_call" }], value: 1 },
      { dimensions: [{ name: "event_class", value: "tool_result" }], value: 2 },
      { dimensions: [{ name: "event_class", value: "verification" }], value: 2 },
    ])
    const depth = resultFor(first, trajectoryMetricIds.maxFunctionDepth)
    expect(depth.status).toBe("available")
    if (depth.status === "unavailable") throw new TypeError("expected function depth")
    expect(depth.values).toEqual([{ dimensions: [], value: 2 }])
    expect(depth.limitations).toEqual([])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.results)).toBe(true)
  })

  test("marks orphan-only function exits unavailable", () => {
    // Given: an artifact whose only function boundary is an orphan exit.
    const normalized = functionDepthFixture([
      [{ kind: "function_exit", name: "PRIVATE_ORPHAN", detail: "PRIVATE_DETAIL" }],
    ])

    // When: maximum function nesting depth is derived.
    const depth = resultFor(
      deriveTrajectoryMetrics(normalized),
      trajectoryMetricIds.maxFunctionDepth,
    )

    // Then: no depth is fabricated and the malformed boundary is explicit.
    expect(depth.status).toBe("unavailable")
    expect(Object.hasOwn(depth, "values")).toBe(false)
    expect(depth.limitations).toEqual([
      { code: "function_boundary_direction_unavailable", unavailableCount: 1 },
    ])
  })

  test("marks known function depth partial after an unbalanced exit", () => {
    // Given: a valid depth-one span followed by an orphan exit.
    const normalized = functionDepthFixture([
      [
        { kind: "function_enter", name: "PRIVATE_FUNCTION", detail: "PRIVATE_ENTER" },
        { kind: "function_exit", name: "PRIVATE_FUNCTION", detail: "PRIVATE_EXIT" },
        { kind: "function_exit", name: "PRIVATE_ORPHAN", detail: "PRIVATE_ORPHAN_EXIT" },
      ],
    ])

    // When: maximum function nesting depth is derived.
    const depth = resultFor(
      deriveTrajectoryMetrics(normalized),
      trajectoryMetricIds.maxFunctionDepth,
    )

    // Then: the observed maximum is a lower bound with an explicit limitation.
    expect(depth.status).toBe("partial")
    if (depth.status !== "partial") throw new TypeError("expected partial function depth")
    expect(depth.values).toEqual([{ dimensions: [], value: 1 }])
    expect(depth.limitations).toEqual([
      { code: "function_boundary_direction_unavailable", unavailableCount: 1 },
    ])
  })

  test("marks unclosed function entries partial", () => {
    // Given: nested function entries with one missing closing boundary.
    const normalized = functionDepthFixture([
      [
        { kind: "function_enter", name: "PRIVATE_OUTER", detail: "PRIVATE_ENTER" },
        { kind: "function_enter", name: "PRIVATE_INNER", detail: "PRIVATE_ENTER" },
        { kind: "function_exit", name: "PRIVATE_INNER", detail: "PRIVATE_EXIT" },
      ],
    ])

    // When: maximum function nesting depth is derived.
    const depth = resultFor(
      deriveTrajectoryMetrics(normalized),
      trajectoryMetricIds.maxFunctionDepth,
    )

    // Then: the known maximum remains a partial lower bound rather than an exact claim.
    expect(depth.status).toBe("partial")
    if (depth.status !== "partial") throw new TypeError("expected partial function depth")
    expect(depth.values).toEqual([{ dimensions: [], value: 2 }])
    expect(depth.limitations).toEqual([
      { code: "function_boundary_direction_unavailable", unavailableCount: 1 },
    ])
  })

  test("resets function nesting at artifact boundaries", () => {
    // Given: an unclosed depth-one span followed by a separate balanced depth-one artifact.
    const normalized = functionDepthFixture([
      [{ kind: "function_enter", name: "PRIVATE_FIRST", detail: "PRIVATE_FIRST_ENTER" }],
      [
        { kind: "function_enter", name: "PRIVATE_SECOND", detail: "PRIVATE_SECOND_ENTER" },
        { kind: "function_exit", name: "PRIVATE_SECOND", detail: "PRIVATE_SECOND_EXIT" },
      ],
    ])

    // When: maximum function nesting depth is derived across the observation set.
    const depth = resultFor(
      deriveTrajectoryMetrics(normalized),
      trajectoryMetricIds.maxFunctionDepth,
    )

    // Then: the first artifact cannot inflate the second artifact's nesting depth.
    expect(depth.status).toBe("partial")
    if (depth.status !== "partial") throw new TypeError("expected partial function depth")
    expect(depth.values).toEqual([{ dimensions: [], value: 1 }])
    expect(depth.limitations).toEqual([
      { code: "function_boundary_direction_unavailable", unavailableCount: 1 },
    ])
  })

  test("never serializes unavailable facts as zero or false", () => {
    // Given: v1 tool-result and verification observations with no structured facts.
    const normalized = normalizeAtfObservations({
      archiveSha256,
      artifacts: [
        artifact("traces/unavailable.atf.json", {
          runtime: "private",
          status: "instrumented",
          eventCount: 2,
          events: [
            { kind: "tool_result", name: "tool", detail: "PRIVATE_RESULT" },
            { kind: "verification", name: "check", detail: "PRIVATE_LABEL" },
          ],
        }),
      ],
    })

    // When: unavailable-only dimensions are derived.
    const metrics = deriveTrajectoryMetrics(normalized)

    // Then: each unavailable result omits values instead of fabricating 0 or false.
    for (const metricId of [
      trajectoryMetricIds.matchedToolResultCount,
      trajectoryMetricIds.unmatchedToolResultCount,
      trajectoryMetricIds.toolErrorCount,
    ]) {
      const result = resultFor(metrics, metricId)
      expect(result.status).toBe("unavailable")
      expect(Object.hasOwn(result, "values")).toBe(false)
      expect(JSON.stringify(result)).not.toContain('"value":0')
      expect(JSON.stringify(result)).not.toContain(":false")
    }
    expect(metrics.results.map((result) => result.metricId)).not.toContain(
      "trajectory.verification.labels.total",
    )
  })

  test("marks bounded or incomplete derivations explicitly", () => {
    // Given: a valid normalized set whose caller reports bounded analysis coverage.
    const normalized = deterministicFixture()

    // When: metrics are derived from the bounded observation subset.
    const metrics = deriveTrajectoryMetrics(normalized, {
      status: "partial",
      reason: "observation_limit_reached",
    })

    // Then: known counts remain lower bounds and every output collection stays bounded.
    const total = resultFor(metrics, trajectoryMetricIds.totalEvents)
    expect(total.status).toBe("partial")
    if (total.status !== "partial") throw new TypeError("expected partial total")
    expect(total.values[0]?.value).toBe(13)
    expect(total.limitations).toContainEqual({ code: "analysis_coverage_partial" })
    expect(metrics.limitations).toContain("analysis_coverage_partial")
    expect(metrics.results.length).toBeLessThanOrEqual(trajectoryMetricPolicy.maxResults)
    for (const result of metrics.results) {
      if (result.status !== "unavailable") {
        expect(result.values.length).toBeLessThanOrEqual(trajectoryMetricPolicy.maxValuesPerResult)
      }
      expect(result.limitations.length).toBeLessThanOrEqual(
        trajectoryMetricPolicy.maxLimitationsPerResult,
      )
    }
    expect(Buffer.byteLength(JSON.stringify(metrics))).toBeLessThanOrEqual(
      trajectoryMetricPolicy.maxSerializedBytes,
    )
  })

  test("rejects malformed or semantically inconsistent normalized input", () => {
    // Given: one count-inconsistent set and one cross-field-inconsistent tool result.
    const normalized = deterministicFixture()
    const countMismatch = {
      ...normalized,
      summary: { ...normalized.summary, observationCount: normalized.summary.observationCount - 1 },
    }
    const inconsistentFacts = {
      ...normalized,
      observations: normalized.observations.map((observation) =>
        observation.eventClass === "tool_result" && observation.toolUseLink.status === "matched"
          ? { ...observation, error: { availability: "not_applicable" } }
          : observation,
      ),
    }

    // When: each untrusted read model crosses the metric boundary.
    const malformedError = captureError(() => deriveTrajectoryMetrics(countMismatch))
    const inconsistentError = captureError(() => deriveTrajectoryMetrics(inconsistentFacts))

    // Then: both are rejected with bounded errors that do not echo source content.
    expect(malformedError.message).toBe("invalid_normalized_observation_set")
    expect(inconsistentError.message).toBe("inconsistent_normalized_observation_set")
    expect(malformedError.message).not.toContain("PRIVATE")
    expect(inconsistentError.message).not.toContain("PRIVATE")
  })

  test("rejects inconsistent normalized function direction", () => {
    // Given: a normalized step externally changed to not-applicable direction.
    const normalized = deterministicFixture()
    const inconsistentDirection = {
      ...normalized,
      observations: normalized.observations.map((observation) =>
        observation.eventClass === "step"
          ? { ...observation, functionDirection: "not_applicable" }
          : observation,
      ),
    }

    // When: the malformed normalized set crosses the metric boundary.
    const error = captureError(() => deriveTrajectoryMetrics(inconsistentDirection))

    // Then: the boundary rejects it without echoing source content.
    expect(error.message).toBe("invalid_normalized_observation_set")
    expect(error.message).not.toContain("PRIVATE")
  })
})
