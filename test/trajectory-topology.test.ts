import { describe, expect, test } from "bun:test"

import type { MorphologyTraceEvent } from "../src/trajectory/morphology"
import {
  buildTrajectoryTopology,
  trajectoryTopologyPreviewCeiling,
  trajectoryTopologySchema,
} from "../src/trajectory/topology"

const event = (kind: string, name: string, detail = "detail"): MorphologyTraceEvent => ({
  kind,
  name,
  detail,
})

describe("trajectory topology", () => {
  test("reconstructs a nested tree from function enter/exit ordering", () => {
    const topology = buildTrajectoryTopology(
      [
        event("session_start", "trajectory.demo"),
        event("function_enter", "run_pipeline"),
        event("llm_call", "trajectory.demo"),
        event("function_enter", "call_tool"),
        event("tool_call", "search_docs"),
        event("function_exit", "call_tool"),
        event("verification", "trajectory.demo", "[redacted]"),
        event("function_exit", "run_pipeline"),
      ],
      100,
    )

    expect(topology.sampledEventCount).toBe(8)
    expect(topology.totalEventCount).toBe(8)
    expect(topology.truncated).toBe(false)
    expect(topology.roots).toHaveLength(2)
    expect(topology.roots[0]).toMatchObject({ kind: "session_start", depth: 0, children: [] })

    const pipeline = topology.roots[1]
    expect(pipeline).toMatchObject({ kind: "function_enter", name: "run_pipeline", depth: 0 })
    expect(pipeline?.children.map((child) => child.name)).toEqual([
      "trajectory.demo",
      "call_tool",
      "trajectory.demo",
    ])
    const callTool = pipeline?.children[1]
    expect(callTool).toMatchObject({ kind: "function_enter", depth: 1 })
    expect(callTool?.children).toEqual([
      { kind: "tool_call", name: "search_docs", depth: 2, children: [] },
    ])
    expect(trajectoryTopologySchema.parse(topology)).toEqual(topology)
  })

  test("never exposes event detail text through topology nodes", () => {
    const topology = buildTrajectoryTopology(
      [event("tool_call", "search_docs", "super-sensitive-payload")],
      10,
    )
    expect(JSON.stringify(topology)).not.toContain("super-sensitive-payload")
    expect(Object.keys(topology.roots[0] ?? {}).sort()).toEqual([
      "children",
      "depth",
      "kind",
      "name",
    ])
  })

  test("bounds the preview by maxPreviewEvents and flags truncation", () => {
    const events = [
      event("function_enter", "run"),
      event("tool_call", "first"),
      event("tool_call", "second"),
      event("function_exit", "run"),
    ]

    const truncated = buildTrajectoryTopology(events, 2)
    expect(truncated).toMatchObject({
      sampledEventCount: 2,
      totalEventCount: 4,
      truncated: true,
    })
    expect(truncated.roots[0]?.children.map((child) => child.name)).toEqual(["first"])

    const disabled = buildTrajectoryTopology(events, 0)
    expect(disabled).toEqual({
      sampledEventCount: 0,
      totalEventCount: 4,
      truncated: true,
      roots: [],
    })

    const negative = buildTrajectoryTopology(events, -3)
    expect(negative.sampledEventCount).toBe(0)
  })

  test("enforces the hard preview ceiling and survives unmatched exits", () => {
    const manyEvents = Array.from({ length: trajectoryTopologyPreviewCeiling + 20 }, (_, index) =>
      event("tool_call", `tool-${index}`),
    )
    const capped = buildTrajectoryTopology(manyEvents, 10_000)
    expect(capped.sampledEventCount).toBe(trajectoryTopologyPreviewCeiling)
    expect(capped.truncated).toBe(true)

    const orphanExit = buildTrajectoryTopology(
      [event("function_exit", "orphan"), event("tool_call", "after")],
      10,
    )
    expect(orphanExit.roots).toEqual([{ kind: "tool_call", name: "after", depth: 0, children: [] }])
  })
})
