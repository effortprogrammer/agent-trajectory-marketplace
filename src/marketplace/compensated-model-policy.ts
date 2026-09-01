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

export const compensatedTokenCap = 100_000_000

export type CompensatedUsageAssessment = Readonly<{
  readonly hasOnlySupportedUsage: boolean
  readonly hasPositiveUsage: boolean
  readonly supportedTokenCount: number
  readonly isWithinTokenCap: boolean
}>

export type CompensatedUsageAggregate = CompensatedUsageAssessment

const tokenSumWithinCap = (left: number, right: number): number | undefined =>
  left > compensatedTokenCap - right ? undefined : left + right

export const assessCompensatedUsage = (
  document: HarnessTraceDocument,
): CompensatedUsageAssessment => {
  let hasPositiveUsage = false
  let supportedTokenCount = 0
  for (const event of document.events) {
    const usage = event.payload?.usage
    if (usage === undefined) continue
    const inputTokens = usage.inputTokens ?? 0
    const outputTokens = usage.outputTokens ?? 0
    if (inputTokens === 0 && outputTokens === 0) continue
    hasPositiveUsage = true
    if (
      event.timestamp === undefined
      || event.sourceEventId === undefined
      || usage.model === undefined
      || !compensatedModels.has(normalizedModel(usage.model))
    ) {
      return Object.freeze({
        hasOnlySupportedUsage: false,
        hasPositiveUsage,
        supportedTokenCount,
        isWithinTokenCap: true,
      })
    }
    const eventTokenCount = tokenSumWithinCap(inputTokens, outputTokens)
    if (eventTokenCount === undefined) {
      return Object.freeze({
        hasOnlySupportedUsage: true,
        hasPositiveUsage,
        supportedTokenCount,
        isWithinTokenCap: false,
      })
    }
    const total = tokenSumWithinCap(supportedTokenCount, eventTokenCount)
    if (total === undefined) {
      return Object.freeze({
        hasOnlySupportedUsage: true,
        hasPositiveUsage,
        supportedTokenCount,
        isWithinTokenCap: false,
      })
    }
    supportedTokenCount = total
  }
  return Object.freeze({
    hasOnlySupportedUsage: true,
    hasPositiveUsage,
    supportedTokenCount,
    isWithinTokenCap: true,
  })
}

export const aggregateCompensatedUsage = (
  assessments: readonly CompensatedUsageAssessment[],
): CompensatedUsageAggregate => {
  let hasOnlySupportedUsage = true
  let hasPositiveUsage = false
  let supportedTokenCount = 0
  let isWithinTokenCap = true
  for (const assessment of assessments) {
    hasOnlySupportedUsage &&= assessment.hasOnlySupportedUsage
    hasPositiveUsage ||= assessment.hasPositiveUsage
    if (!isWithinTokenCap || !assessment.isWithinTokenCap) {
      isWithinTokenCap = false
      continue
    }
    const total = tokenSumWithinCap(
      supportedTokenCount,
      assessment.supportedTokenCount,
    )
    if (total === undefined) {
      isWithinTokenCap = false
      continue
    }
    supportedTokenCount = total
  }
  return Object.freeze({
    hasOnlySupportedUsage,
    hasPositiveUsage,
    supportedTokenCount,
    isWithinTokenCap,
  })
}

export const hasSupportedPositiveUsage = (
  assessment: CompensatedUsageAggregate,
): boolean => assessment.hasOnlySupportedUsage
  && assessment.hasPositiveUsage
  && assessment.isWithinTokenCap

export const hasOnlyCompensatedModelUsage = (
  document: HarnessTraceDocument,
): boolean => hasSupportedPositiveUsage(
  aggregateCompensatedUsage([assessCompensatedUsage(document)]),
)
