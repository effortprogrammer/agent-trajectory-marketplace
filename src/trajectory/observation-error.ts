export const TrajectoryObservationErrorCode = {
  InvalidSourceIdentity: "invalid_source_identity",
  ArtifactHashMismatch: "artifact_hash_mismatch",
  InvalidAtfJson: "invalid_atf_json",
  InvalidAtfSchema: "invalid_atf_schema",
  EventCountMismatch: "event_count_mismatch",
  LimitExceeded: "observation_limit_exceeded",
  InvalidToolLink: "invalid_tool_link",
} as const

export type TrajectoryObservationErrorCode =
  (typeof TrajectoryObservationErrorCode)[keyof typeof TrajectoryObservationErrorCode]

export type TrajectoryObservationErrorField =
  | "archiveSha256"
  | "artifacts"
  | "artifactPath"
  | "artifactSha256"
  | "sourceBytes"
  | "formatVersion"
  | "eventCount"
  | "payload"

export type TrajectoryObservationErrorReason = "duplicate_tool_call" | "duplicate_tool_result"

type ObservationErrorContext = Readonly<{
  field?: TrajectoryObservationErrorField
  reason?: TrajectoryObservationErrorReason
  artifactIndex?: number
  eventIndex?: number
}>

export class TrajectoryObservationError extends Error {
  readonly name = "TrajectoryObservationError"
  readonly code: TrajectoryObservationErrorCode
  readonly field?: TrajectoryObservationErrorField
  readonly reason?: TrajectoryObservationErrorReason
  readonly artifactIndex?: number
  readonly eventIndex?: number

  constructor(code: TrajectoryObservationErrorCode, context: ObservationErrorContext = {}) {
    const parts: string[] = [code]
    if (context.field !== undefined) parts.push(`field=${context.field}`)
    if (context.reason !== undefined) parts.push(`reason=${context.reason}`)
    if (context.artifactIndex !== undefined) parts.push(`artifact=${context.artifactIndex}`)
    if (context.eventIndex !== undefined) parts.push(`event=${context.eventIndex}`)
    super(parts.join(" "))
    this.code = code
    if (context.field !== undefined) this.field = context.field
    if (context.reason !== undefined) this.reason = context.reason
    if (context.artifactIndex !== undefined) this.artifactIndex = context.artifactIndex
    if (context.eventIndex !== undefined) this.eventIndex = context.eventIndex
  }
}
