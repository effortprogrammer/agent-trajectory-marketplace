import type { TrajectoryObservationEventClass } from "./observation-contract"
import {
  openInferenceProjectionSchema,
  otelGenAiProjectionSchema,
  type TrajectoryProjectionBundle,
  type TrajectoryProjectionProfileName,
  trajectoryProjectionProfiles,
} from "./projection-contract"
import { buildProjectionManifest } from "./projection-loss"
import {
  type ProjectionEvent,
  parseProjectionSource,
  projectionStatusFor,
} from "./projection-source"

const otelOperationFor: Partial<Record<TrajectoryObservationEventClass, string>> = {
  llm: "chat",
  tool_call: "execute_tool",
  tool_result: "execute_tool",
}

const openInferenceKindFor: Record<TrajectoryObservationEventClass, string> = {
  session: "AGENT",
  step: "CHAIN",
  llm: "LLM",
  tool_call: "TOOL",
  tool_result: "TOOL",
  verification: "EVALUATOR",
  error: "UNKNOWN",
  other: "UNKNOWN",
}

const otelProjection = (events: readonly ProjectionEvent[]) =>
  otelGenAiProjectionSchema.parse({
    schemaVersion: 1,
    kind: "otel-genai-projection",
    profile: trajectoryProjectionProfiles.otelGenAi,
    resource: {
      attributes: { "service.name": "agent-trajectory-marketplace.local-projection" },
    },
    spans: events.map(({ fact, payload }) => {
      const attributes: Record<string, string | number | boolean> = {
        "atf.event.class": fact.eventClass,
      }
      const operation = otelOperationFor[fact.eventClass]
      if (operation !== undefined) attributes["gen_ai.operation.name"] = operation
      if (payload?.usage?.inputTokens !== undefined) {
        attributes["gen_ai.usage.input_tokens"] = payload.usage.inputTokens
      }
      if (payload?.usage?.outputTokens !== undefined) {
        attributes["gen_ai.usage.output_tokens"] = payload.usage.outputTokens
      }
      if (payload?.isError !== undefined) attributes["atf.result.is_error"] = payload.isError
      return {
        name: `atf.${fact.eventClass}`,
        kind: "INTERNAL",
        attributes,
        status: { code: projectionStatusFor(fact) },
      }
    }),
  })

const openInferenceProjection = (events: readonly ProjectionEvent[]) =>
  openInferenceProjectionSchema.parse({
    schemaVersion: 1,
    kind: "openinference-projection",
    profile: trajectoryProjectionProfiles.openInference,
    spans: events.map(({ fact, payload }) => {
      const attributes: Record<string, string | number | boolean> = {
        "openinference.span.kind": openInferenceKindFor[fact.eventClass],
      }
      if (payload?.usage?.inputTokens !== undefined) {
        attributes["llm.token_count.prompt"] = payload.usage.inputTokens
      }
      if (payload?.usage?.outputTokens !== undefined) {
        attributes["llm.token_count.completion"] = payload.usage.outputTokens
      }
      if (payload?.isError !== undefined) attributes["atf.result.is_error"] = payload.isError
      return {
        name: `atf.${fact.eventClass}`,
        attributes,
        status: { code: projectionStatusFor(fact) },
      }
    }),
  })

export const buildTrajectoryProjection = (
  profile: TrajectoryProjectionProfileName,
  sourceBytes: Uint8Array,
): TrajectoryProjectionBundle => {
  const source = parseProjectionSource(sourceBytes)
  const projection =
    profile === "otel-genai"
      ? otelProjection(source.events)
      : openInferenceProjection(source.events)
  return {
    projection,
    manifest: buildProjectionManifest({ profile, source, sourceBytes }),
  }
}
