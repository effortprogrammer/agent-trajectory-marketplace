import { z } from "zod"

import type { MorphologyTraceEvent } from "./morphology"

// Hard server-side ceiling; marketplace metadata already caps
// sample.maxPreviewEvents at 100, this guards direct callers.
export const trajectoryTopologyPreviewCeiling = 100

export type TrajectoryTopologyNode = {
  readonly kind: string
  readonly name: string
  readonly depth: number
  readonly children: readonly TrajectoryTopologyNode[]
}

export const trajectoryTopologyNodeSchema: z.ZodType<TrajectoryTopologyNode> = z.lazy(() =>
  z
    .object({
      kind: z.string().min(1),
      name: z.string().min(1),
      depth: z.number().int().nonnegative(),
      children: z.array(trajectoryTopologyNodeSchema),
    })
    .strict(),
)

export const trajectoryTopologySchema = z
  .object({
    sampledEventCount: z.number().int().nonnegative(),
    totalEventCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    roots: z.array(trajectoryTopologyNodeSchema),
  })
  .strict()

export type TrajectoryTopology = z.infer<typeof trajectoryTopologySchema>

type MutableTopologyNode = {
  kind: string
  name: string
  depth: number
  children: MutableTopologyNode[]
}

// Trace events carry no parent or span ids, so the tree is reconstructed
// from function_enter/function_exit ordering: enters open a span, exits close
// the innermost open span, and every other event attaches as a leaf of the
// currently open span. Only kind and name are exposed; event detail stays
// download-gated.
export const buildTrajectoryTopology = (
  events: readonly MorphologyTraceEvent[],
  maxPreviewEvents: number,
): TrajectoryTopology => {
  const previewBudget = Math.max(
    0,
    Math.min(Math.trunc(maxPreviewEvents), trajectoryTopologyPreviewCeiling),
  )
  const sampled = events.slice(0, previewBudget)
  const roots: MutableTopologyNode[] = []
  const stack: MutableTopologyNode[] = []

  const attach = (node: MutableTopologyNode) => {
    const parent = stack.at(-1)
    if (parent === undefined) {
      roots.push(node)
      return
    }
    parent.children.push(node)
  }

  for (const event of sampled) {
    if (event.kind === "function_exit") {
      stack.pop()
      continue
    }
    const node: MutableTopologyNode = {
      kind: event.kind,
      name: event.name,
      depth: stack.length,
      children: [],
    }
    attach(node)
    if (event.kind === "function_enter") {
      stack.push(node)
    }
  }

  return trajectoryTopologySchema.parse({
    sampledEventCount: sampled.length,
    totalEventCount: events.length,
    truncated: events.length > sampled.length,
    roots,
  })
}
