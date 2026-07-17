import { createHash } from "node:crypto"

import { normalizeObservationInputSchema } from "./observation-atf"
import {
  observationIdSchema,
  type TrajectoryObservation,
  type TrajectoryObservationId,
  type TrajectoryObservationSet,
  type TrajectoryObservationSource,
  trajectoryObservationNormalizerVersion,
  trajectoryObservationPolicy,
  trajectoryObservationSchemaVersion,
} from "./observation-contract"
import {
  TrajectoryObservationError,
  TrajectoryObservationErrorCode,
  type TrajectoryObservationErrorField,
} from "./observation-error"
import { type ObservationDraft, resolveArtifactLinks } from "./observation-linker"
import { parseObservationArtifact } from "./observation-parser"

const sourceFieldFromPath = (path: readonly PropertyKey[]): TrajectoryObservationErrorField => {
  const first = path[0]
  if (first === "archiveSha256") return "archiveSha256"
  if (first !== "artifacts") return "artifacts"
  const field = path[2]
  if (field === "artifactPath") return "artifactPath"
  if (field === "artifactSha256") return "artifactSha256"
  if (field === "sourceBytes") return "sourceBytes"
  return "artifacts"
}

const observationIdForSource = (source: TrajectoryObservationSource): TrajectoryObservationId =>
  observationIdSchema.parse(
    `obs_${createHash("sha256")
      .update(trajectoryObservationNormalizerVersion)
      .update("\0")
      .update(source.archiveSha256)
      .update("\0")
      .update(source.artifactPath)
      .update("\0")
      .update(source.artifactSha256)
      .update("\0")
      .update(String(source.eventIndex))
      .digest("hex")}`,
  )

export const normalizeAtfObservations = (input: unknown): TrajectoryObservationSet => {
  const parsedInput = normalizeObservationInputSchema.safeParse(input)
  if (!parsedInput.success) {
    const path = parsedInput.error.issues[0]?.path ?? []
    const artifactIndex = typeof path[1] === "number" ? path[1] : undefined
    throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidSourceIdentity, {
      field: sourceFieldFromPath(path),
      ...(artifactIndex === undefined ? {} : { artifactIndex }),
    })
  }

  const observations: TrajectoryObservation[] = []
  const paths = new Set<string>()
  let v1 = 0
  let v2 = 0
  for (const [artifactIndex, artifact] of parsedInput.data.artifacts.entries()) {
    if (paths.has(artifact.artifactPath)) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidSourceIdentity, {
        field: "artifactPath",
        artifactIndex,
      })
    }
    paths.add(artifact.artifactPath)
    const recomputedSha256 = createHash("sha256").update(artifact.sourceBytes).digest("hex")
    if (recomputedSha256 !== artifact.artifactSha256) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.ArtifactHashMismatch, {
        field: "artifactSha256",
        artifactIndex,
      })
    }
    const parsedArtifact = parseObservationArtifact(artifact.sourceBytes, artifactIndex)
    if (
      observations.length + parsedArtifact.events.length >
      trajectoryObservationPolicy.maxTotalObservations
    ) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.LimitExceeded, {
        field: "eventCount",
        artifactIndex,
      })
    }
    if (parsedArtifact.version === 1) v1 += 1
    else v2 += 1
    const drafts = parsedArtifact.events.map((event): ObservationDraft => {
      const source = Object.freeze({
        archiveSha256: parsedInput.data.archiveSha256,
        artifactPath: artifact.artifactPath,
        artifactSha256: artifact.artifactSha256,
        eventIndex: event.eventIndex,
      })
      return {
        ...event,
        id: observationIdForSource(source),
        ordinal: observations.length + event.eventIndex,
        source,
      }
    })
    observations.push(...resolveArtifactLinks(drafts, artifactIndex))
  }

  return Object.freeze({
    schemaVersion: trajectoryObservationSchemaVersion,
    normalizerVersion: trajectoryObservationNormalizerVersion,
    summary: Object.freeze({
      artifactCount: parsedInput.data.artifacts.length,
      observationCount: observations.length,
      atfVersionCounts: Object.freeze({ v1, v2 }),
    }),
    observations: Object.freeze(observations),
  })
}
