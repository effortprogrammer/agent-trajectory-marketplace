import type { z } from "zod"

import { v1DocumentSchema, v2DocumentSchema } from "./observation-atf"
import { type ParsedEventFact, parseObservationArtifact } from "./observation-parser"

type V1Document = z.infer<typeof v1DocumentSchema>
type V2Document = z.infer<typeof v2DocumentSchema>
type V2Event = V2Document["events"][number]
type V2Payload = V2Event["payload"]

export type ProjectionSourceMetadata = Readonly<{
  timestamp: string
  sourceEventId: string
  parentSourceEventId?: string
}>

export type ParentLinkageResolution =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "resolved"; parentSpanIndex: number }>
  | Readonly<{ status: "unresolved"; parentSourceEventId: string }>

export type ProjectionEvent = Readonly<{
  eventIndex: number
  fact: ParsedEventFact
  kind: string
  name: string
  detail: string
  payload?: V2Payload
  sourceMetadata?: ProjectionSourceMetadata
  parentLinkage: ParentLinkageResolution
}>

export type ProjectionSource = Readonly<{
  version: 1 | 2
  document: V1Document | V2Document
  events: readonly ProjectionEvent[]
}>

const extractSourceMetadata = (event: V2Event): ProjectionSourceMetadata | undefined => {
  if (event.timestamp === undefined || event.sourceEventId === undefined) return undefined
  return {
    timestamp: event.timestamp,
    sourceEventId: event.sourceEventId,
    ...(event.parentSourceEventId === undefined
      ? {}
      : { parentSourceEventId: event.parentSourceEventId }),
  }
}

const resolveParentLinkage = (
  sourceMetadata: ProjectionSourceMetadata,
  sourceEventIndexes: ReadonlyMap<string, number>,
  currentIndex: number,
): ParentLinkageResolution => {
  if (sourceMetadata.parentSourceEventId === undefined) {
    return { status: "absent" }
  }
  const parentSpanIndex = sourceEventIndexes.get(sourceMetadata.parentSourceEventId)
  if (parentSpanIndex === undefined) {
    return {
      status: "unresolved",
      parentSourceEventId: sourceMetadata.parentSourceEventId,
    }
  }
  if (parentSpanIndex === currentIndex) {
    return {
      status: "unresolved",
      parentSourceEventId: sourceMetadata.parentSourceEventId,
    }
  }
  return { status: "resolved", parentSpanIndex }
}

export const parseProjectionSource = (sourceBytes: Uint8Array): ProjectionSource => {
  const parsedArtifact = parseObservationArtifact(sourceBytes, 0)
  const json: unknown = JSON.parse(new TextDecoder().decode(sourceBytes))
  if (parsedArtifact.version === 1) {
    const document = v1DocumentSchema.parse(json)
    const events: ProjectionEvent[] = parsedArtifact.events.map((fact) => {
      const event = document.events[fact.eventIndex]
      if (event === undefined) throw new TypeError("projection_event_index_out_of_bounds")
      return {
        eventIndex: fact.eventIndex,
        fact,
        kind: event.kind,
        name: event.name,
        detail: event.detail,
        parentLinkage: { status: "absent" } as const,
      }
    })
    return { version: 1, document, events }
  }
  const document = v2DocumentSchema.parse(json)
  const sourceEventIndexes = new Map<string, number>()
  for (const fact of parsedArtifact.events) {
    const event = document.events[fact.eventIndex]
    if (event === undefined) throw new TypeError("projection_event_index_out_of_bounds")
    const sourceMetadata = extractSourceMetadata(event)
    if (sourceMetadata !== undefined) {
      sourceEventIndexes.set(sourceMetadata.sourceEventId, fact.eventIndex)
    }
  }
  const events: ProjectionEvent[] = []
  for (const fact of parsedArtifact.events) {
    const event = document.events[fact.eventIndex]
    if (event === undefined) throw new TypeError("projection_event_index_out_of_bounds")
    const sourceMetadata = extractSourceMetadata(event)
    const parentLinkage =
      sourceMetadata === undefined
        ? ({ status: "absent" } as const)
        : resolveParentLinkage(sourceMetadata, sourceEventIndexes, fact.eventIndex)
    events.push({
      eventIndex: fact.eventIndex,
      fact,
      kind: event.kind,
      name: event.name,
      detail: event.detail,
      ...(event.payload === undefined ? {} : { payload: event.payload }),
      ...(sourceMetadata === undefined ? {} : { sourceMetadata }),
      parentLinkage,
    })
  }
  return { version: 2, document, events }
}

export const projectionStatusFor = (fact: ParsedEventFact): "UNSET" | "OK" | "ERROR" => {
  if (fact.error.availability === "available") {
    return fact.error.outcome === "error" ? "ERROR" : "OK"
  }
  if (fact.verification.availability === "available") {
    return fact.verification.outcome === "passed" ? "OK" : "ERROR"
  }
  return "UNSET"
}
