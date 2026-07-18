import { z } from "zod"

import { atfTimestampSchema, trajectoryObservationPolicy } from "../observation-contract"

// Source-event IDs are bounded by the shared observation policy so harness
// adapters and downstream ATF normalization enforce one length cap.
export const harnessSourceEventIdSchema = z
  .string()
  .min(1)
  .max(trajectoryObservationPolicy.maxSourceEventIdChars)

// Adapters that successfully read a complete attestation group from a raw
// harness log entry return this; the parent ID is present only when it
// validated against the same bound as the source ID.
export type HarnessSourceAttestation = Readonly<{
  timestamp: string
  sourceEventId: string
  parentSourceEventId?: string
}>

// Parses unknown raw harness log entries into a typed object instead of an
// `as Record<PropertyKey, unknown>` cast. `.passthrough()` tolerates unknown
// sibling fields so adapters can pass full log entries through unchanged.
const rawAttestationRecordSchema = z
  .object({
    timestamp: z.unknown().optional(),
    sourceEventId: z.unknown().optional(),
    parentSourceEventId: z.unknown().optional(),
  })
  .passthrough()

// Safely extracts a complete bounded source attestation from an unknown raw
// harness log entry. Returns undefined when timestamp or source ID is missing
// or fails the shared lexical/length bound; an invalid parent value is
// omitted rather than failing the whole extraction. IDs are never
// synthesized — only values that actually validated are returned.
export const extractHarnessSourceAttestation = (
  raw: unknown,
): HarnessSourceAttestation | undefined => {
  const recordResult = rawAttestationRecordSchema.safeParse(raw)
  if (!recordResult.success) return undefined
  const record = recordResult.data
  const timestampResult = atfTimestampSchema.safeParse(record.timestamp)
  const sourceResult = harnessSourceEventIdSchema.safeParse(record.sourceEventId)
  if (!timestampResult.success || !sourceResult.success) return undefined
  const parentResult = harnessSourceEventIdSchema.safeParse(record.parentSourceEventId)
  return {
    timestamp: timestampResult.data,
    sourceEventId: sourceResult.data,
    ...(parentResult.success ? { parentSourceEventId: parentResult.data } : {}),
  }
}
