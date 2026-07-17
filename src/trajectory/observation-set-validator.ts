import type {
  TrajectoryObservation,
  TrajectoryObservationEventClass,
  TrajectoryObservationSet,
} from "./observation-contract"

export type ObservationSetValidationIssue = Readonly<{
  path: readonly (string | number)[]
  message: string
}>

type IndexedObservation = Readonly<{
  index: number
  observation: TrajectoryObservation
}>

const sourceTupleKey = (observation: TrajectoryObservation): string =>
  `${observation.source.archiveSha256}\0${observation.source.artifactPath}\0${observation.source.artifactSha256}\0${observation.source.eventIndex}`

const matchedEventClassesAreValid = (
  sourceClass: TrajectoryObservationEventClass,
  counterpartClass: TrajectoryObservationEventClass,
): boolean =>
  (sourceClass === "tool_call" && counterpartClass === "tool_result") ||
  (sourceClass === "tool_result" && counterpartClass === "tool_call")

const issue = (
  index: number,
  field: "id" | "source" | "toolUseLink",
  message: string,
): ObservationSetValidationIssue => ({
  path: ["observations", index, field],
  message,
})

export const observationSetValidationIssues = (
  value: TrajectoryObservationSet,
): readonly ObservationSetValidationIssue[] => {
  const issues: ObservationSetValidationIssue[] = []
  if (value.summary.observationCount !== value.observations.length) {
    issues.push({
      path: ["summary", "observationCount"],
      message: "observation count does not match records",
    })
  }
  const versionTotal = value.summary.atfVersionCounts.v1 + value.summary.atfVersionCounts.v2
  if (value.summary.artifactCount !== versionTotal) {
    issues.push({
      path: ["summary", "artifactCount"],
      message: "artifact count does not match ATF version totals",
    })
  }

  const observationsById = new Map<string, IndexedObservation>()
  const sourceTuples = new Set<string>()
  for (const [index, observation] of value.observations.entries()) {
    if (observation.ordinal !== index) {
      issues.push({
        path: ["observations", index, "ordinal"],
        message: "observation ordinal does not match record order",
      })
    }
    if (observationsById.has(observation.id)) {
      issues.push(issue(index, "id", "duplicate observation id"))
    } else {
      observationsById.set(observation.id, { index, observation })
    }
    const sourceKey = sourceTupleKey(observation)
    if (sourceTuples.has(sourceKey)) {
      issues.push(issue(index, "source", "duplicate observation source"))
    } else {
      sourceTuples.add(sourceKey)
    }
  }

  for (const [index, observation] of value.observations.entries()) {
    const link = observation.toolUseLink
    if (link.status !== "matched") continue
    if (link.counterpartObservationId === observation.id) {
      issues.push(issue(index, "toolUseLink", "matched counterpart is self"))
      continue
    }
    const counterpart = observationsById.get(link.counterpartObservationId)
    if (counterpart === undefined) {
      issues.push(issue(index, "toolUseLink", "matched counterpart is absent"))
      continue
    }
    if (!matchedEventClassesAreValid(observation.eventClass, counterpart.observation.eventClass)) {
      issues.push(issue(index, "toolUseLink", "matched event classes are invalid"))
    }
    const counterpartLink = counterpart.observation.toolUseLink
    if (
      counterpartLink.status !== "matched" ||
      counterpartLink.counterpartObservationId !== observation.id
    ) {
      issues.push(issue(index, "toolUseLink", "matched link is not reciprocal"))
    }
  }
  return issues
}
