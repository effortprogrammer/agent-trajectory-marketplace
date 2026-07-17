import type { TrajectoryObservation } from "./observation"

export type FunctionDepthDerivation =
  | Readonly<{ status: "available"; depth: number }>
  | Readonly<{ status: "partial"; depth: number; unbalancedCount: number }>
  | Readonly<{ status: "unavailable"; unbalancedCount: number }>

type ArtifactDepthState = {
  depth: number
}

const artifactKey = (observation: TrajectoryObservation): string =>
  JSON.stringify([
    observation.source.archiveSha256,
    observation.source.artifactPath,
    observation.source.artifactSha256,
  ])

export const deriveFunctionDepth = (
  observations: readonly TrajectoryObservation[],
): FunctionDepthDerivation => {
  const states = new Map<string, ArtifactDepthState>()
  let maximumDepth = 0
  let unbalancedCount = 0
  for (const observation of observations) {
    if (observation.functionDirection === "not_applicable") continue
    const key = artifactKey(observation)
    const state = states.get(key) ?? { depth: 0 }
    states.set(key, state)
    if (observation.functionDirection === "enter") {
      state.depth += 1
      maximumDepth = Math.max(maximumDepth, state.depth)
      continue
    }
    if (state.depth === 0) unbalancedCount += 1
    else state.depth -= 1
  }
  for (const state of states.values()) unbalancedCount += state.depth
  if (unbalancedCount === 0) return Object.freeze({ status: "available", depth: maximumDepth })
  if (maximumDepth === 0) return Object.freeze({ status: "unavailable", unbalancedCount })
  return Object.freeze({ status: "partial", depth: maximumDepth, unbalancedCount })
}
