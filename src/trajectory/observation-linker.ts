import type {
  TrajectoryObservation,
  TrajectoryObservationId,
  TrajectoryObservationSource,
  TrajectoryObservationToolLink,
} from "./observation-contract"
import {
  TrajectoryObservationError,
  TrajectoryObservationErrorCode,
  type TrajectoryObservationErrorReason,
} from "./observation-error"
import type { ParsedEventFact } from "./observation-parser"

export type ObservationDraft = ParsedEventFact &
  Readonly<{
    id: TrajectoryObservationId
    ordinal: number
    source: TrajectoryObservationSource
  }>

const notApplicableLink = Object.freeze({ status: "not_applicable" } as const)
const unavailableLink = Object.freeze({ status: "unavailable" } as const)

const invalidLink = (
  reason: Extract<TrajectoryObservationToolLink, { status: "invalid" }>["reason"],
): TrajectoryObservationToolLink => Object.freeze({ status: "invalid", reason })

const duplicateReason = (draft: ObservationDraft): TrajectoryObservationErrorReason =>
  draft.eventClass === "tool_call" ? "duplicate_tool_call" : "duplicate_tool_result"

const counterpartFor = (
  draft: ObservationDraft,
  calls: ReadonlyMap<string, ObservationDraft>,
  results: ReadonlyMap<string, ObservationDraft>,
): ObservationDraft | undefined =>
  draft.eventClass === "tool_call"
    ? results.get(draft.toolUseId ?? "")
    : calls.get(draft.toolUseId ?? "")

const resolvedLink = (
  draft: ObservationDraft,
  calls: ReadonlyMap<string, ObservationDraft>,
  results: ReadonlyMap<string, ObservationDraft>,
): TrajectoryObservationToolLink => {
  if (draft.eventClass !== "tool_call" && draft.eventClass !== "tool_result") {
    return notApplicableLink
  }
  if (draft.toolUseId === undefined) return unavailableLink
  const counterpart = counterpartFor(draft, calls, results)
  if (counterpart === undefined) {
    return invalidLink(draft.eventClass === "tool_call" ? "unmatched_call" : "unmatched_result")
  }
  if (draft.toolName !== counterpart.toolName) return invalidLink("name_mismatch")
  const callIndex = draft.eventClass === "tool_call" ? draft.eventIndex : counterpart.eventIndex
  const resultIndex = draft.eventClass === "tool_result" ? draft.eventIndex : counterpart.eventIndex
  if (callIndex >= resultIndex) return invalidLink("result_before_call")
  return Object.freeze({ status: "matched", counterpartObservationId: counterpart.id })
}

export const resolveArtifactLinks = (
  drafts: readonly ObservationDraft[],
  artifactIndex: number,
): readonly TrajectoryObservation[] => {
  const calls = new Map<string, ObservationDraft>()
  const results = new Map<string, ObservationDraft>()
  for (const draft of drafts) {
    if (draft.toolUseId === undefined) continue
    const target = draft.eventClass === "tool_call" ? calls : results
    if (target.has(draft.toolUseId)) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidToolLink, {
        reason: duplicateReason(draft),
        artifactIndex,
        eventIndex: draft.eventIndex,
      })
    }
    target.set(draft.toolUseId, draft)
  }
  return Object.freeze(
    drafts.map(
      (draft): TrajectoryObservation =>
        Object.freeze({
          id: draft.id,
          ordinal: draft.ordinal,
          source: draft.source,
          eventClass: draft.eventClass,
          functionDirection: draft.functionDirection,
          toolUseLink: resolvedLink(draft, calls, results),
          error: draft.error,
          verification: draft.verification,
        }),
    ),
  )
}
