import { z } from "zod"

export const morphologyTraceEventSchema = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  detail: z.string(),
})

export const morphologyTraceDocumentSchema = z.object({
  runtime: z.string().min(1),
  status: z.string().min(1),
  eventCount: z.number().int().nonnegative(),
  events: z.array(morphologyTraceEventSchema),
})

export type MorphologyTraceEvent = z.infer<typeof morphologyTraceEventSchema>
export type MorphologyTraceDocument = z.infer<typeof morphologyTraceDocumentSchema>

export const trajectoryMorphologyKindShareSchema = z
  .object({
    kind: z.string().min(1),
    count: z.number().int().nonnegative(),
    share: z.number().min(0).max(1),
  })
  .strict()

export const trajectoryMorphologyToolCallSchema = z
  .object({
    name: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .strict()

export const trajectoryMorphologySchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    uniqueEventNames: z.number().int().nonnegative(),
    kindDistribution: z.array(trajectoryMorphologyKindShareSchema),
    toolCallDistribution: z.array(trajectoryMorphologyToolCallSchema),
    llmCallCount: z.number().int().nonnegative(),
    functionSpanCount: z.number().int().nonnegative(),
    maxFunctionDepth: z.number().int().nonnegative(),
  })
  .strict()

export type TrajectoryMorphology = z.infer<typeof trajectoryMorphologySchema>

export const trajectoryMorphologyToolCallLimit = 12

const roundShare = (count: number, total: number) =>
  total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000

const sortedCountEntries = (counts: ReadonlyMap<string, number>) =>
  [...counts.entries()].sort(([leftKey, leftCount], [rightKey, rightCount]) =>
    leftCount === rightCount ? leftKey.localeCompare(rightKey) : rightCount - leftCount,
  )

export const computeTrajectoryMorphology = (
  events: readonly MorphologyTraceEvent[],
): TrajectoryMorphology => {
  const kindCounts = new Map<string, number>()
  const toolCallCounts = new Map<string, number>()
  const eventNames = new Set<string>()
  let llmCallCount = 0
  let functionSpanCount = 0
  let functionDepth = 0
  let maxFunctionDepth = 0

  for (const event of events) {
    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1)
    eventNames.add(event.name)
    if (event.kind === "tool_call") {
      toolCallCounts.set(event.name, (toolCallCounts.get(event.name) ?? 0) + 1)
    }
    if (event.kind === "llm_call") {
      llmCallCount += 1
    }
    if (event.kind === "function_enter") {
      functionDepth += 1
      maxFunctionDepth = Math.max(maxFunctionDepth, functionDepth)
    }
    if (event.kind === "function_exit" && functionDepth > 0) {
      functionDepth -= 1
      functionSpanCount += 1
    }
  }

  const kindDistribution = sortedCountEntries(kindCounts).map(([kind, count]) => ({
    kind,
    count,
    share: roundShare(count, events.length),
  }))
  const toolCallDistribution = sortedCountEntries(toolCallCounts)
    .slice(0, trajectoryMorphologyToolCallLimit)
    .map(([name, count]) => ({ name, count }))

  return trajectoryMorphologySchema.parse({
    eventCount: events.length,
    uniqueEventNames: eventNames.size,
    kindDistribution,
    toolCallDistribution,
    llmCallCount,
    functionSpanCount,
    maxFunctionDepth,
  })
}
