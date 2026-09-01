import type { HarnessTraceDocument } from "../trajectory/adapters/contract"

export const compensatedModelIds = [
  "claude-fable-5",
  "gpt-5.6-sol",
] as const

const compensatedModels: ReadonlySet<string> = new Set(compensatedModelIds)

// Exactly the ASCII whitespace admitted by normalization: U+0009–U+000D and U+0020.
// Deliberately not \s or String.prototype.trim(): both strip U+00A0 and U+FEFF,
// while the cross-repository contract permits only the explicit ASCII set.
const asciiWhitespaceRun = /^[\u0009-\u000D\u0020]+|[\u0009-\u000D\u0020]+$/g

const normalizedModel = (value: string): string =>
  value.replace(asciiWhitespaceRun, "").toLowerCase()

export type CompensatedUsageAssessment = Readonly<{
  readonly hasOnlySupportedUsage: boolean
  readonly hasPositiveUsage: boolean
}>

export const assessCompensatedUsage = (
  document: HarnessTraceDocument,
): CompensatedUsageAssessment => {
  let hasPositiveUsage = false
  for (const event of document.events) {
    const usage = event.payload?.usage
    if (usage === undefined) continue
    const tokenCount = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    if (tokenCount <= 0) continue
    hasPositiveUsage = true
    if (
      event.timestamp === undefined
      || event.sourceEventId === undefined
      || usage.model === undefined
      || !compensatedModels.has(normalizedModel(usage.model))
    ) {
      return Object.freeze({ hasOnlySupportedUsage: false, hasPositiveUsage })
    }
  }
  return Object.freeze({ hasOnlySupportedUsage: true, hasPositiveUsage })
}

export const hasOnlyCompensatedModelUsage = (
  document: HarnessTraceDocument,
): boolean => {
  const assessment = assessCompensatedUsage(document)
  return assessment.hasOnlySupportedUsage && assessment.hasPositiveUsage
}
