import { Buffer } from "node:buffer"
import { type ParsedV2Event, v1DocumentSchema, v2DocumentSchema } from "./observation-atf"
import {
  type TrajectoryObservationErrorAvailability,
  type TrajectoryObservationEventClass,
  type TrajectoryObservationFunctionDirection,
  type TrajectoryObservationVerificationAvailability,
  trajectoryObservationPolicy,
} from "./observation-contract"
import {
  TrajectoryObservationError,
  TrajectoryObservationErrorCode,
  type TrajectoryObservationErrorField,
} from "./observation-error"
import { observationEventStructureForKind } from "./observation-event-structure"

export type ParsedArtifact = Readonly<{
  version: 1 | 2
  events: readonly ParsedEventFact[]
}>

export type ParsedEventFact = Readonly<{
  eventIndex: number
  eventClass: TrajectoryObservationEventClass
  functionDirection: TrajectoryObservationFunctionDirection
  error: TrajectoryObservationErrorAvailability
  verification: TrajectoryObservationVerificationAvailability
  toolUseId?: string
  toolName?: string
}>

const notApplicableAvailability = Object.freeze({ availability: "not_applicable" } as const)
const unavailableAvailability = Object.freeze({ availability: "unavailable" } as const)

const eventIndexFromPath = (path: readonly PropertyKey[]): number | undefined =>
  path[0] === "events" && typeof path[1] === "number" ? path[1] : undefined

const inspectJsonBounds = (root: unknown, maxStringBytes?: number): boolean => {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    nodes += 1
    if (nodes > trajectoryObservationPolicy.maxJsonNodes) return false
    if (current.depth > trajectoryObservationPolicy.maxJsonDepth) return false
    if (typeof current.value === "string") {
      if (maxStringBytes !== undefined && Buffer.byteLength(current.value) > maxStringBytes) {
        return false
      }
      continue
    }
    if (current.value === null || typeof current.value !== "object") continue
    const nextDepth = current.depth + 1
    for (const child of Object.values(current.value)) {
      stack.push({ value: child, depth: nextDepth })
    }
  }
  return true
}

const payloadIsBounded = (payload: NonNullable<ParsedV2Event["payload"]>): boolean => {
  if (!inspectJsonBounds(payload, trajectoryObservationPolicy.maxPayloadStringBytes)) return false
  const serialized = JSON.stringify(payload)
  return (
    serialized !== undefined &&
    Buffer.byteLength(serialized) <= trajectoryObservationPolicy.maxPayloadSerializedBytes
  )
}

const payloadMatchesEvent = (event: ParsedV2Event): boolean => {
  const payload = event.payload
  if (payload === undefined) return true
  if (
    payload.toolUseId !== undefined &&
    event.kind !== "tool_call" &&
    event.kind !== "tool_result"
  ) {
    return false
  }
  if (payload.input !== undefined && event.kind !== "tool_call") return false
  if (
    (payload.output !== undefined ||
      payload.isError !== undefined ||
      payload.byteCount !== undefined) &&
    event.kind !== "tool_result"
  ) {
    return false
  }
  if (
    (payload.passed !== undefined || payload.label !== undefined) &&
    event.kind !== "verification"
  ) {
    return false
  }
  if (
    (payload.role !== undefined || payload.content !== undefined) &&
    event.kind !== "function_enter" &&
    event.kind !== "llm_call"
  ) {
    return false
  }
  return (
    payload.usage === undefined ||
    event.kind === "llm_call" ||
    // Hermes exposes usage only at the session aggregate (tokscale parity),
    // so the adapter attaches it to session_start instead of fanning it out
    // across llm_call events that did not individually report tokens.
    event.kind === "session_start"
  )
}

const parseSourceJson = (sourceBytes: Uint8Array, artifactIndex: number): unknown => {
  if (sourceBytes.byteLength > trajectoryObservationPolicy.maxArtifactBytes) {
    throw new TrajectoryObservationError(TrajectoryObservationErrorCode.LimitExceeded, {
      field: "sourceBytes",
      artifactIndex,
    })
  }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidAtfJson, {
        artifactIndex,
      })
    }
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidAtfJson, {
        artifactIndex,
      })
    }
    throw error
  }
}

const factForV2Event = (event: ParsedV2Event, eventIndex: number): ParsedEventFact => {
  const structure = observationEventStructureForKind(event.kind)
  const { eventClass } = structure
  const error: TrajectoryObservationErrorAvailability =
    eventClass === "error"
      ? Object.freeze({ availability: "available", outcome: "error" })
      : eventClass === "tool_result"
        ? event.payload?.isError === undefined
          ? unavailableAvailability
          : Object.freeze({
              availability: "available",
              outcome: event.payload.isError ? "error" : "success",
            })
        : notApplicableAvailability
  const verification: TrajectoryObservationVerificationAvailability =
    eventClass !== "verification"
      ? notApplicableAvailability
      : event.payload?.passed === undefined
        ? unavailableAvailability
        : Object.freeze({
            availability: "available",
            outcome: event.payload.passed ? "passed" : "failed",
          })
  return {
    eventIndex,
    ...structure,
    error,
    verification,
    ...(event.payload?.toolUseId === undefined ? {} : { toolUseId: event.payload.toolUseId }),
    ...(eventClass === "tool_call" || eventClass === "tool_result" ? { toolName: event.name } : {}),
  }
}

const invalidSchemaError = (
  artifactIndex: number,
  path: readonly PropertyKey[],
  field?: TrajectoryObservationErrorField,
): TrajectoryObservationError => {
  const eventIndex = eventIndexFromPath(path)
  return new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidAtfSchema, {
    artifactIndex,
    ...(field === undefined ? {} : { field }),
    ...(eventIndex === undefined ? {} : { eventIndex }),
  })
}

export const parseObservationArtifact = (
  sourceBytes: Uint8Array,
  artifactIndex: number,
): ParsedArtifact => {
  const json = parseSourceJson(sourceBytes, artifactIndex)
  if (!inspectJsonBounds(json)) {
    throw new TrajectoryObservationError(TrajectoryObservationErrorCode.LimitExceeded, {
      artifactIndex,
    })
  }
  const formatVersion =
    json !== null && typeof json === "object" ? Reflect.get(json, "formatVersion") : undefined
  if (formatVersion !== undefined && formatVersion !== 1 && formatVersion !== 2) {
    throw new TrajectoryObservationError(TrajectoryObservationErrorCode.InvalidAtfSchema, {
      field: "formatVersion",
      artifactIndex,
    })
  }
  if (formatVersion === 2) {
    const parsed = v2DocumentSchema.safeParse(json)
    if (!parsed.success) throw invalidSchemaError(artifactIndex, parsed.error.issues[0]?.path ?? [])
    if (parsed.data.eventCount !== parsed.data.events.length) {
      throw new TrajectoryObservationError(TrajectoryObservationErrorCode.EventCountMismatch, {
        field: "eventCount",
        artifactIndex,
      })
    }
    const events = parsed.data.events.map((event, eventIndex) => {
      if (
        Buffer.byteLength(event.detail) > trajectoryObservationPolicy.maxDetailBytes ||
        (event.payload !== undefined && !payloadIsBounded(event.payload)) ||
        !payloadMatchesEvent(event)
      ) {
        throw invalidSchemaError(artifactIndex, ["events", eventIndex], "payload")
      }
      return factForV2Event(event, eventIndex)
    })
    return { version: 2, events }
  }
  const parsed = v1DocumentSchema.safeParse(json)
  if (!parsed.success) throw invalidSchemaError(artifactIndex, parsed.error.issues[0]?.path ?? [])
  if (parsed.data.eventCount !== parsed.data.events.length) {
    throw new TrajectoryObservationError(TrajectoryObservationErrorCode.EventCountMismatch, {
      field: "eventCount",
      artifactIndex,
    })
  }
  const events = parsed.data.events.map((event, eventIndex): ParsedEventFact => {
    if (Buffer.byteLength(event.detail) > trajectoryObservationPolicy.maxDetailBytes) {
      throw invalidSchemaError(artifactIndex, ["events", eventIndex])
    }
    const structure = observationEventStructureForKind(event.kind)
    const { eventClass } = structure
    return {
      eventIndex,
      ...structure,
      error:
        eventClass === "error"
          ? Object.freeze({ availability: "available", outcome: "error" })
          : eventClass === "tool_result"
            ? unavailableAvailability
            : notApplicableAvailability,
      verification:
        eventClass === "verification" ? unavailableAvailability : notApplicableAvailability,
      ...(eventClass === "tool_call" || eventClass === "tool_result"
        ? { toolName: event.name }
        : {}),
    }
  })
  return { version: 1, events }
}
