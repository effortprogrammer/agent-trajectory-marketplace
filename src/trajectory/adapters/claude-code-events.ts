import {
  type HarnessEventPayload,
  type HarnessSourceAttestation,
  type HarnessTraceEvent,
  sanitizeHarnessPayload,
} from "./contract"

export type ClaudeEventSink = {
  readonly events: HarnessTraceEvent[]
  hasPayload: boolean
  hasAttestation: boolean
}

export type ClaudeEmitOptions = {
  readonly payload?: HarnessEventPayload | undefined
  readonly attestation?: HarnessSourceAttestation | undefined
}

export const createClaudeEventSink = (): ClaudeEventSink => ({
  events: [],
  hasPayload: false,
  hasAttestation: false,
})

export const emitClaudeEvent = (
  sink: ClaudeEventSink,
  kind: string,
  name: string,
  options?: ClaudeEmitOptions,
): HarnessTraceEvent => {
  const sanitized =
    options?.payload === undefined ? undefined : sanitizeHarnessPayload(options.payload)
  if (sanitized !== undefined) sink.hasPayload = true
  const attestation = options?.attestation
  if (attestation !== undefined) sink.hasAttestation = true
  const event: HarnessTraceEvent = {
    kind,
    name,
    ...(sanitized === undefined ? {} : { payload: sanitized }),
    ...(attestation === undefined
      ? {}
      : {
          timestamp: attestation.timestamp,
          sourceEventId: attestation.sourceEventId,
          ...(attestation.parentSourceEventId === undefined
            ? {}
            : { parentSourceEventId: attestation.parentSourceEventId }),
        }),
  }
  sink.events.push(event)
  return event
}
