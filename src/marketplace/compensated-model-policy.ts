import type { HarnessTraceDocument } from "../trajectory/adapters/contract"

export const compensatedModelIds = [
  "claude-fable-5",
  "gpt-5.6-sol",
] as const

const compensatedModels: ReadonlySet<string> = new Set(compensatedModelIds)

const normalizedModel = (value: string): string =>
  value.trim().toLowerCase()

export const hasOnlyCompensatedModelUsage = (
  document: HarnessTraceDocument,
): boolean => {
  let hasCompensatedUsage = false
  for (const event of document.events) {
    const usage = event.payload?.usage
    if (usage === undefined) continue
    const tokenCount = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    if (tokenCount <= 0) continue
    if (
      event.timestamp === undefined
      || event.sourceEventId === undefined
      || usage.model === undefined
      || !compensatedModels.has(normalizedModel(usage.model))
    ) {
      return false
    }
    hasCompensatedUsage = true
  }
  return hasCompensatedUsage
}
