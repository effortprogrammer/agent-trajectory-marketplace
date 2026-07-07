import { describe, expect, test } from "bun:test"

import {
  computeTrajectoryMorphology,
  type MorphologyTraceEvent,
  trajectoryMorphologySchema,
  trajectoryMorphologyToolCallLimit,
} from "../src/trajectory/morphology"

const event = (kind: string, name: string, detail = "detail"): MorphologyTraceEvent => ({
  kind,
  name,
  detail,
})

describe("trajectory morphology", () => {
  test("returns zeroed morphology for an empty trace", () => {
    expect(computeTrajectoryMorphology([])).toEqual({
      eventCount: 0,
      uniqueEventNames: 0,
      kindDistribution: [],
      toolCallDistribution: [],
      llmCallCount: 0,
      functionSpanCount: 0,
      maxFunctionDepth: 0,
    })
  })

  test("quantifies kind distribution, tool calls, and enter/exit nesting", () => {
    const morphology = computeTrajectoryMorphology([
      event("session_start", "trajectory.demo"),
      event("function_enter", "run_pipeline"),
      event("llm_call", "trajectory.demo"),
      event("function_enter", "call_tool"),
      event("tool_call", "search_docs"),
      event("function_exit", "call_tool"),
      event("function_enter", "call_tool"),
      event("tool_call", "search_docs"),
      event("function_exit", "call_tool"),
      event("tool_call", "write_report"),
      event("verification", "trajectory.demo", "[redacted]"),
      event("function_exit", "run_pipeline"),
    ])

    expect(morphology.eventCount).toBe(12)
    expect(morphology.uniqueEventNames).toBe(5)
    expect(morphology.llmCallCount).toBe(1)
    expect(morphology.functionSpanCount).toBe(3)
    expect(morphology.maxFunctionDepth).toBe(2)
    expect(morphology.kindDistribution[0]).toEqual({
      kind: "function_enter",
      count: 3,
      share: 0.25,
    })
    expect(morphology.kindDistribution.map((entry) => entry.kind)).toEqual([
      "function_enter",
      "function_exit",
      "tool_call",
      "llm_call",
      "session_start",
      "verification",
    ])
    expect(morphology.toolCallDistribution).toEqual([
      { name: "search_docs", count: 2 },
      { name: "write_report", count: 1 },
    ])
    expect(trajectoryMorphologySchema.parse(morphology)).toEqual(morphology)
  })

  test("ignores unmatched function exits instead of underflowing depth", () => {
    const morphology = computeTrajectoryMorphology([
      event("function_exit", "orphan"),
      event("function_enter", "run"),
      event("function_exit", "run"),
    ])
    expect(morphology.functionSpanCount).toBe(1)
    expect(morphology.maxFunctionDepth).toBe(1)
  })

  test("caps the tool call distribution and keeps deterministic ordering", () => {
    const events = Array.from({ length: trajectoryMorphologyToolCallLimit + 3 }, (_, index) =>
      event("tool_call", `tool-${String(index).padStart(2, "0")}`),
    )
    const morphology = computeTrajectoryMorphology([...events, event("tool_call", "tool-00")])
    expect(morphology.toolCallDistribution).toHaveLength(trajectoryMorphologyToolCallLimit)
    expect(morphology.toolCallDistribution[0]).toEqual({ name: "tool-00", count: 2 })
    expect(morphology.toolCallDistribution[1]).toEqual({ name: "tool-01", count: 1 })
  })
})
