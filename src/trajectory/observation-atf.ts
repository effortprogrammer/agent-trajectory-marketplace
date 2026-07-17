import { z } from "zod"
import {
  observationArchiveSha256Schema,
  observationArtifactPathSchema,
  observationArtifactSha256Schema,
  trajectoryObservationPolicy,
} from "./observation-contract"
import { privacyStampSchema } from "./privacy/contract"

const assistantBlockSchema = z
  .object({
    type: z.enum(["text", "tool_use", "thinking"]),
    text: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
  })
  .strict()

const payloadSchema = z
  .object({
    role: z.enum(["user", "assistant"]).optional(),
    content: z
      .union([
        z.string(),
        z.array(assistantBlockSchema).max(trajectoryObservationPolicy.maxAssistantBlocks),
      ])
      .optional(),
    toolUseId: z.string().min(1).max(trajectoryObservationPolicy.maxToolUseIdChars).optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    isError: z.boolean().optional(),
    byteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    truncated: z.boolean().optional(),
    usage: z
      .object({
        model: z.string().optional(),
        inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
        outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
        latencyMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .strict()
      .optional(),
    passed: z.boolean().optional(),
    label: z.string().min(1).optional(),
  })
  .strict()

const commonDocumentShape = {
  runtime: z.string().min(1).max(trajectoryObservationPolicy.maxRuntimeChars),
  status: z.string().min(1).max(trajectoryObservationPolicy.maxStatusChars),
  eventCount: z.number().int().nonnegative().max(trajectoryObservationPolicy.maxEventsPerArtifact),
  privacy: privacyStampSchema.optional(),
} as const

const commonEventShape = {
  kind: z.string().min(1).max(trajectoryObservationPolicy.maxEventKindChars),
  name: z.string().min(1).max(trajectoryObservationPolicy.maxEventNameChars),
  detail: z.string(),
} as const

const v1EventSchema = z.object(commonEventShape).strict()
export const v2EventSchema = z
  .object({ ...commonEventShape, payload: payloadSchema.optional() })
  .strict()

export const v1DocumentSchema = z
  .object({
    ...commonDocumentShape,
    formatVersion: z.literal(1).optional(),
    events: z.array(v1EventSchema).max(trajectoryObservationPolicy.maxEventsPerArtifact),
  })
  .strict()

export const v2DocumentSchema = z
  .object({
    ...commonDocumentShape,
    formatVersion: z.literal(2),
    events: z.array(v2EventSchema).max(trajectoryObservationPolicy.maxEventsPerArtifact),
  })
  .strict()

const artifactInputSchema = z
  .object({
    artifactPath: observationArtifactPathSchema,
    artifactSha256: observationArtifactSha256Schema,
    sourceBytes: z.instanceof(Uint8Array),
  })
  .strict()

export const normalizeObservationInputSchema = z
  .object({
    archiveSha256: observationArchiveSha256Schema,
    artifacts: z.array(artifactInputSchema).min(1).max(trajectoryObservationPolicy.maxArtifacts),
  })
  .strict()

export type ParsedV2Event = z.infer<typeof v2EventSchema>
