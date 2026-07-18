import type {
  TrajectoryProjectionManifest,
  TrajectoryProjectionProfileName,
} from "./projection-contract"
import { type ProjectionEvent, projectionStatusFor } from "./projection-source"
import { augmentRegularEventMappingWithSourceMetadata } from "./projection-source-metadata-loss"

type EventMapping = TrajectoryProjectionManifest["events"][number]

const bytewiseCompare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))

const jsonPointerSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1")

type MarkerStackItem = Readonly<{
  value: unknown
  path: string
  opaque: boolean
}>

const markerPaths = (root: unknown, rootPath: string, marker: (value: string) => boolean) => {
  const matches = new Set<string>()
  const stack: MarkerStackItem[] = [{ value: root, path: rootPath, opaque: false }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (typeof current.value === "string") {
      if (marker(current.value)) matches.add(current.path)
      continue
    }
    if (current.value === null || typeof current.value !== "object") continue
    const entries = Array.isArray(current.value)
      ? current.value.map((value, index) => [String(index), value] as const)
      : Object.entries(current.value)
    for (const [key, value] of entries) {
      const becomesOpaque =
        (current.path === `${rootPath}/payload` && (key === "input" || key === "output")) ||
        (current.path.startsWith(`${rootPath}/payload/content/`) && key === "input")
      stack.push({
        value,
        path: current.opaque ? current.path : `${current.path}/${jsonPointerSegment(key)}`,
        opaque: current.opaque || becomesOpaque,
      })
    }
  }
  return [...matches].sort(bytewiseCompare)
}

const contentPaths = (event: ProjectionEvent, base: string): EventMapping["droppedFields"] => {
  const payload = event.payload
  const suffixes = [
    "name",
    "detail",
    payload?.content !== undefined && "payload/content",
    payload?.input !== undefined && "payload/input",
    payload?.output !== undefined && "payload/output",
    payload?.usage?.model !== undefined && "payload/usage/model",
    payload?.label !== undefined && "payload/label",
  ].filter((value): value is string => typeof value === "string")
  return suffixes.map((suffix) => ({
    sourcePath: `${base}/${suffix}`,
    reason: "content_omitted_by_projection_policy",
  }))
}

const unsupportedPaths = (event: ProjectionEvent, base: string): EventMapping["unsupported"] => {
  const payload = event.payload
  const candidates: ReadonlyArray<readonly [string, unknown, string]> = [
    ["payload/toolUseId", payload?.toolUseId, "source_link_identity_not_projected"],
    ["payload/byteCount", payload?.byteCount, "no_supported_profile_field"],
    ["payload/usage/latencyMs", payload?.usage?.latencyMs, "source_timestamps_unavailable"],
    [
      "payload/usage/cachedInputTokens",
      payload?.usage?.cachedInputTokens,
      "no_supported_profile_field",
    ],
    [
      "payload/usage/reasoningOutputTokens",
      payload?.usage?.reasoningOutputTokens,
      "no_supported_profile_field",
    ],
    [
      "payload/usage/cacheWriteTokens",
      payload?.usage?.cacheWriteTokens,
      "no_supported_profile_field",
    ],
    ["payload/role", payload?.role, "content_role_not_projected_without_content"],
    [
      "kind",
      event.fact.eventClass === "other" ? "present" : undefined,
      "unrecognized_event_kind_normalized",
    ],
  ]
  return candidates
    .filter(([, value]) => value !== undefined)
    .map(([suffix, , reason]) => ({ sourcePath: `${base}/${suffix}`, reason }))
}

const tokenTarget = (
  profile: TrajectoryProjectionProfileName,
  token: "input" | "output",
): string => {
  if (profile === "otel-genai") {
    return token === "input" ? "gen_ai.usage.input_tokens" : "gen_ai.usage.output_tokens"
  }
  return token === "input" ? "llm.token_count.prompt" : "llm.token_count.completion"
}

export const buildProjectionEventMapping = (
  event: ProjectionEvent,
  profile: TrajectoryProjectionProfileName,
): EventMapping => {
  const sourceBase = `/events/${event.eventIndex}`
  const targetBase = `/spans/${event.eventIndex}`
  const mapping = buildRegularEventMapping(event, profile, sourceBase, targetBase)
  return augmentRegularEventMappingWithSourceMetadata(mapping, event, sourceBase, targetBase)
}

const buildRegularEventMapping = (
  event: ProjectionEvent,
  profile: TrajectoryProjectionProfileName,
  sourceBase: string,
  targetBase: string,
): EventMapping => {
  const transformedFields: EventMapping["transformedFields"] = [
    {
      sourcePath: `${sourceBase}/kind`,
      targetPath: `${targetBase}/name`,
      operation: "classify_atf_event_kind",
    },
  ]
  if (profile === "otel-genai") {
    transformedFields.push({
      sourcePath: `${sourceBase}/kind`,
      targetPath: `${targetBase}/attributes/atf.event.class`,
      operation: "classify_atf_event_kind",
    })
    if (
      event.fact.eventClass === "llm" ||
      event.fact.eventClass === "tool_call" ||
      event.fact.eventClass === "tool_result"
    ) {
      transformedFields.push({
        sourcePath: `${sourceBase}/kind`,
        targetPath: `${targetBase}/attributes/gen_ai.operation.name`,
        operation: "map_to_otel_genai_operation",
      })
    }
  } else {
    transformedFields.push({
      sourcePath: `${sourceBase}/kind`,
      targetPath: `${targetBase}/attributes/openinference.span.kind`,
      operation: "map_to_openinference_span_kind",
    })
  }
  const payload = event.payload
  if (payload?.usage?.inputTokens !== undefined) {
    transformedFields.push({
      sourcePath: `${sourceBase}/payload/usage/inputTokens`,
      targetPath: `${targetBase}/attributes/${tokenTarget(profile, "input")}`,
      operation: "copy_integer",
    })
  }
  if (payload?.usage?.outputTokens !== undefined) {
    transformedFields.push({
      sourcePath: `${sourceBase}/payload/usage/outputTokens`,
      targetPath: `${targetBase}/attributes/${tokenTarget(profile, "output")}`,
      operation: "copy_integer",
    })
  }
  if (payload?.isError !== undefined) {
    transformedFields.push({
      sourcePath: `${sourceBase}/payload/isError`,
      targetPath: `${targetBase}/status/code`,
      operation: "boolean_to_span_status",
    })
    transformedFields.push({
      sourcePath: `${sourceBase}/payload/isError`,
      targetPath: `${targetBase}/attributes/atf.result.is_error`,
      operation: "copy_boolean",
    })
  }
  if (payload?.passed !== undefined) {
    transformedFields.push({
      sourcePath: `${sourceBase}/payload/passed`,
      targetPath: `${targetBase}/status/code`,
      operation: "boolean_to_span_status",
    })
  }
  const defaultedFields: EventMapping["defaultedFields"] = []
  if (profile === "otel-genai") {
    defaultedFields.push({
      targetPath: `${targetBase}/kind`,
      value: "INTERNAL",
      reason: "source_span_kind_unavailable",
    })
  }
  if (projectionStatusFor(event.fact) === "UNSET") {
    defaultedFields.push({
      targetPath: `${targetBase}/status/code`,
      value: "UNSET",
      reason: "structured_outcome_unavailable",
    })
  }
  const redaction = markerPaths(
    event,
    sourceBase,
    (value) => value.includes("[redacted]") || value.includes("[pii:"),
  ).map((sourcePath) => ({ sourcePath, reason: "source_redaction_marker" }))
  const truncation: EventMapping["truncation"] = []
  if (payload?.truncated === true) {
    truncation.push({ sourcePath: `${sourceBase}/payload`, reason: "source_marked_truncated" })
  }
  truncation.push(
    ...markerPaths(event, sourceBase, (value) => value.includes("[truncated]")).map(
      (sourcePath) => ({ sourcePath, reason: "source_truncation_marker" }),
    ),
  )
  return {
    source: { pointerPath: sourceBase, eventIndex: event.eventIndex },
    target: { pointerPath: targetBase },
    transformedFields,
    defaultedFields,
    droppedFields: contentPaths(event, sourceBase),
    truncation,
    redaction,
    unsupported: unsupportedPaths(event, sourceBase),
  }
}
