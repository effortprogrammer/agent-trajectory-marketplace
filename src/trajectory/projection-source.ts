import type { z } from "zod"

import { v1DocumentSchema, v2DocumentSchema } from "./observation-atf"
import { type ParsedEventFact, parseObservationArtifact } from "./observation-parser"

type V1Document = z.infer<typeof v1DocumentSchema>
type V2Document = z.infer<typeof v2DocumentSchema>
type V2Payload = V2Document["events"][number]["payload"]

export type ProjectionEvent = Readonly<{
  eventIndex: number
  fact: ParsedEventFact
  kind: string
  name: string
  detail: string
  payload?: V2Payload
}>

export type ProjectionSource = Readonly<{
  version: 1 | 2
  document: V1Document | V2Document
  events: readonly ProjectionEvent[]
}>

export const parseProjectionSource = (sourceBytes: Uint8Array): ProjectionSource => {
  const parsedArtifact = parseObservationArtifact(sourceBytes, 0)
  const json: unknown = JSON.parse(new TextDecoder().decode(sourceBytes))
  const document: V1Document | V2Document =
    parsedArtifact.version === 1 ? v1DocumentSchema.parse(json) : v2DocumentSchema.parse(json)
  const events: ProjectionEvent[] = []
  for (const fact of parsedArtifact.events) {
    const event = document.events[fact.eventIndex]
    if (event === undefined) throw new TypeError("projection_event_index_out_of_bounds")
    events.push({
      eventIndex: fact.eventIndex,
      fact,
      kind: event.kind,
      name: event.name,
      detail: event.detail,
      ...("payload" in event && event.payload !== undefined ? { payload: event.payload } : {}),
    })
  }
  return { version: parsedArtifact.version, document, events }
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
