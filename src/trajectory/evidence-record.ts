import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { z } from "zod"

import {
  completeTrajectoryAnalysisCoverage,
  deriveTrajectoryMetrics,
  type TrajectoryAnalysisCoverage,
  type TrajectoryMetricLimitationCode,
  type TrajectoryMetricResult,
  type TrajectoryMetricSet,
  trajectoryAnalysisCoverageSchema,
  trajectoryMetricIds,
  trajectoryMetricSetVersion,
} from "./metrics"
import { trajectoryObservationNormalizerVersion } from "./observation"

export const trajectoryEvidenceSchemaVersion = 1 as const
export const trajectoryEvidenceRecordVersion = "trajectory-evidence-v1" as const
export const trajectoryEvidencePolicy = {
  maxClaims: 5,
  maxLimitations: 16,
  maxSerializedBytes: 32 * 1024,
  hashCommitmentHexChars: 16,
} as const
export const trajectoryEvidenceClaimAuthorities = {
  marketplaceAuthoritative: "marketplace_authoritative",
  sourceAttested: "source_attested",
  adapterOrSellerAttested: "adapter_or_seller_attested",
} as const

export type TrajectoryMarketplaceClaimStatus = "satisfied" | "not_satisfied" | "unavailable"
export type TrajectoryEvidenceClaimId =
  | "integrity"
  | "provenance"
  | "privacy_redaction"
  | "verification_label"
  | "verification_passed"
export type TrajectoryEvidenceClaimAuthority =
  (typeof trajectoryEvidenceClaimAuthorities)[keyof typeof trajectoryEvidenceClaimAuthorities]
export type TrajectoryEvidenceClaimStatus =
  | TrajectoryMarketplaceClaimStatus
  | "attested"
  | "absent"
  | "partial"
export type TrajectoryEvidenceLimitationCode =
  | TrajectoryMetricLimitationCode
  | "integrity_unavailable"
  | "privacy_redaction_unavailable"
  | "provenance_unavailable"
  | "verification_label_unavailable"
  | "verification_outcome_unavailable"

export type TrajectoryEvidenceClaim = Readonly<{
  id: TrajectoryEvidenceClaimId
  authority: TrajectoryEvidenceClaimAuthority
  status: TrajectoryEvidenceClaimStatus
  limitations: readonly TrajectoryEvidenceLimitationCode[]
}>
export type TrajectoryEvidenceSourceSummary = Readonly<{
  sourceSetCommitment: string
  artifactCount: number
  observationCount: number
  atfVersionCounts: Readonly<{ v1: number; v2: number }>
}>
export type TrajectoryEvidenceRecord = Readonly<{
  schemaVersion: typeof trajectoryEvidenceSchemaVersion
  evidenceVersion: typeof trajectoryEvidenceRecordVersion
  normalizerVersion: typeof trajectoryObservationNormalizerVersion
  metricSetVersion: typeof trajectoryMetricSetVersion
  computedAt: string
  availability: "available" | "partial" | "unavailable"
  source?: TrajectoryEvidenceSourceSummary
  metrics: TrajectoryMetricSet
  claims: readonly TrajectoryEvidenceClaim[]
  limitations: readonly TrajectoryEvidenceLimitationCode[]
  derivationHash: string
}>
export type CreateTrajectoryEvidenceRecordInput = Readonly<{
  observationSet?: unknown
  computedAt: string
  coverage?: TrajectoryAnalysisCoverage
  authoritativeClaims: Readonly<{
    integrity: TrajectoryMarketplaceClaimStatus
    provenance: TrajectoryMarketplaceClaimStatus
    privacyRedaction: TrajectoryMarketplaceClaimStatus
  }>
}>

const marketplaceClaimStatusSchema = z.enum(["satisfied", "not_satisfied", "unavailable"])
// biome-ignore format: The strict boundary and its conditional source requirement stay together.
const evidenceInputSchema = z
  .object({
    observationSet: z.unknown().optional(),
    computedAt: z.string().datetime({ offset: true }),
    coverage: trajectoryAnalysisCoverageSchema.optional(),
    authoritativeClaims: z
      .object({
        integrity: marketplaceClaimStatusSchema,
        provenance: marketplaceClaimStatusSchema,
        privacyRedaction: marketplaceClaimStatusSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.coverage?.status !== "unavailable" && value.observationSet === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["observationSet"], message: "required" })
    }
  })

const bytewiseCompare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
const hashCommitment = (identity: string): string =>
  `sha256:${createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, trajectoryEvidencePolicy.hashCommitmentHexChars)}`
const freezeLimitations = (
  limitations: readonly TrajectoryEvidenceLimitationCode[],
): readonly TrajectoryEvidenceLimitationCode[] =>
  Object.freeze(
    [...new Set(limitations)]
      .sort(bytewiseCompare)
      .slice(0, trajectoryEvidencePolicy.maxLimitations),
  )

const claim = (
  id: TrajectoryEvidenceClaimId,
  authority: TrajectoryEvidenceClaimAuthority,
  status: TrajectoryEvidenceClaimStatus,
  limitations: readonly TrajectoryEvidenceLimitationCode[] = [],
): TrajectoryEvidenceClaim =>
  Object.freeze({ id, authority, status, limitations: freezeLimitations(limitations) })

const authoritativeClaim = (
  id: "integrity" | "provenance" | "privacy_redaction",
  status: TrajectoryMarketplaceClaimStatus,
  unavailableCode:
    | "integrity_unavailable"
    | "provenance_unavailable"
    | "privacy_redaction_unavailable",
): TrajectoryEvidenceClaim =>
  claim(
    id,
    trajectoryEvidenceClaimAuthorities.marketplaceAuthoritative,
    status,
    status === "unavailable" ? [unavailableCode] : [],
  )

const metricResult = (metrics: TrajectoryMetricSet, metricId: string): TrajectoryMetricResult => {
  const result = metrics.results.find((candidate) => candidate.metricId === metricId)
  if (result === undefined) throw new TypeError("missing_trajectory_metric_result")
  return result
}

const scalarValue = (result: TrajectoryMetricResult): number | undefined => {
  if (result.status === "unavailable") return undefined
  return result.values[0]?.value
}

// biome-ignore format: Label and outcome authority are derived together to prevent elevation.
const verificationClaims = (metrics: TrajectoryMetricSet): readonly TrajectoryEvidenceClaim[] => {
  const labels = metricResult(metrics, trajectoryMetricIds.verificationLabelCount)
  const labelValue = scalarValue(labels)
  const labelStatus: TrajectoryEvidenceClaimStatus = labels.status === "unavailable"
    ? "unavailable"
    : labels.status === "partial" && labelValue === 0
      ? "partial"
      : (labelValue ?? 0) > 0
        ? "attested"
        : "absent"
  const labelClaim = claim(
    "verification_label",
    trajectoryEvidenceClaimAuthorities.sourceAttested,
    labelStatus,
    labels.status === "unavailable" ? ["verification_label_unavailable"] : [],
  )
  const passed = metricResult(metrics, trajectoryMetricIds.verificationPassedCount)
  const failed = metricResult(metrics, trajectoryMetricIds.verificationFailedCount)
  const outcomeStatus: TrajectoryEvidenceClaimStatus = labelStatus === "absent"
    ? "absent"
    : passed.status === "unavailable" || failed.status === "unavailable"
      ? "unavailable"
      : passed.status === "partial" || failed.status === "partial" || labelStatus === "partial"
        ? "partial"
        : "attested"
  const outcomeClaim = claim(
    "verification_passed",
    trajectoryEvidenceClaimAuthorities.adapterOrSellerAttested,
    outcomeStatus,
    outcomeStatus === "unavailable" ? ["verification_outcome_unavailable"] : [],
  )
  return Object.freeze([labelClaim, outcomeClaim])
}

// biome-ignore format: Both commitment and summary must be present or both remain absent.
const sourceSummary = (metrics: TrajectoryMetricSet): TrajectoryEvidenceSourceSummary | undefined => {
  if (metrics.sourceSummary === undefined || metrics.sourceSetCommitment === undefined) return undefined
  return Object.freeze({
    sourceSetCommitment: metrics.sourceSetCommitment,
    artifactCount: metrics.sourceSummary.artifactCount,
    observationCount: metrics.sourceSummary.observationCount,
    atfVersionCounts: Object.freeze({ ...metrics.sourceSummary.atfVersionCounts }),
  })
}

// biome-ignore format: Identity hashing excludes computedAt within this single construction pipeline.
export const createTrajectoryEvidenceRecord = (input: unknown): TrajectoryEvidenceRecord => {
  const parsed = evidenceInputSchema.safeParse(input)
  if (!parsed.success) throw new TypeError("invalid_trajectory_evidence_input")
  const coverage = parsed.data.coverage ?? completeTrajectoryAnalysisCoverage
  let metrics: TrajectoryMetricSet
  try {
    metrics = deriveTrajectoryMetrics(parsed.data.observationSet, coverage)
  } catch (error) {
    if (error instanceof TypeError) throw new TypeError("invalid_trajectory_evidence_input")
    throw error
  }
  const claims = Object.freeze([
    authoritativeClaim("integrity", parsed.data.authoritativeClaims.integrity, "integrity_unavailable"),
    authoritativeClaim("provenance", parsed.data.authoritativeClaims.provenance, "provenance_unavailable"),
    authoritativeClaim("privacy_redaction", parsed.data.authoritativeClaims.privacyRedaction, "privacy_redaction_unavailable"),
    ...verificationClaims(metrics),
  ])
  const limitations = freezeLimitations([
    ...metrics.limitations,
    ...claims.flatMap((item) => item.limitations),
  ])
  const availability = coverage.status === "unavailable"
    ? "unavailable"
    : limitations.length === 0
      ? "available"
      : "partial"
  const source = sourceSummary(metrics)
  const identity = JSON.stringify([
    trajectoryEvidenceRecordVersion,
    trajectoryObservationNormalizerVersion,
    trajectoryMetricSetVersion,
    availability,
    source === undefined ? null : [source.sourceSetCommitment, source.artifactCount, source.observationCount, source.atfVersionCounts.v1, source.atfVersionCounts.v2],
    metrics.derivationHash,
    claims.map((item) => [item.id, item.authority, item.status, item.limitations]),
    limitations,
  ])
  const record: TrajectoryEvidenceRecord = Object.freeze({
    schemaVersion: trajectoryEvidenceSchemaVersion,
    evidenceVersion: trajectoryEvidenceRecordVersion,
    normalizerVersion: trajectoryObservationNormalizerVersion,
    metricSetVersion: trajectoryMetricSetVersion,
    computedAt: parsed.data.computedAt,
    availability,
    ...(source === undefined ? {} : { source }),
    metrics,
    claims,
    limitations,
    derivationHash: hashCommitment(identity),
  })
  if (Buffer.byteLength(JSON.stringify(record)) > trajectoryEvidencePolicy.maxSerializedBytes) {
    throw new TypeError("trajectory_evidence_output_limit_exceeded")
  }
  return record
}
