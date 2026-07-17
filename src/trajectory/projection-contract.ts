import { z } from "zod"

export const trajectoryProjectionProfiles = {
  otelGenAi: {
    name: "otel-genai",
    specification: "open-telemetry/semantic-conventions-genai",
    specificationVersion: "9a6b37347841bcb5a85110c41ac19c54c4200319",
    projectionSchemaVersion: 1,
  },
  openInference: {
    name: "openinference",
    specification: "Arize-ai/openinference",
    specificationVersion: "a8992df9f443b743c697decc4b659811d5b78d2d",
    projectionSchemaVersion: 1,
  },
} as const

export const trajectoryProjectionProfileNames = ["otel-genai", "openinference"] as const
export type TrajectoryProjectionProfileName = (typeof trajectoryProjectionProfileNames)[number]

const otelProfileSchema = z
  .object({
    name: z.literal(trajectoryProjectionProfiles.otelGenAi.name),
    specification: z.literal(trajectoryProjectionProfiles.otelGenAi.specification),
    specificationVersion: z.literal(trajectoryProjectionProfiles.otelGenAi.specificationVersion),
    projectionSchemaVersion: z.literal(1),
  })
  .strict()

const openInferenceProfileSchema = z
  .object({
    name: z.literal(trajectoryProjectionProfiles.openInference.name),
    specification: z.literal(trajectoryProjectionProfiles.openInference.specification),
    specificationVersion: z.literal(
      trajectoryProjectionProfiles.openInference.specificationVersion,
    ),
    projectionSchemaVersion: z.literal(1),
  })
  .strict()

const projectionScalarSchema = z.union([z.string(), z.number(), z.boolean()])
const spanStatusSchema = z.object({ code: z.enum(["UNSET", "OK", "ERROR"]) }).strict()

export const otelGenAiProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("otel-genai-projection"),
    profile: otelProfileSchema,
    resource: z
      .object({
        attributes: z
          .object({
            "service.name": z.literal("agent-trajectory-marketplace.local-projection"),
          })
          .strict(),
      })
      .strict(),
    spans: z.array(
      z
        .object({
          name: z.string(),
          kind: z.literal("INTERNAL"),
          attributes: z.record(projectionScalarSchema),
          status: spanStatusSchema,
        })
        .strict(),
    ),
  })
  .strict()

export const openInferenceProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("openinference-projection"),
    profile: openInferenceProfileSchema,
    spans: z.array(
      z
        .object({
          name: z.string(),
          attributes: z.record(projectionScalarSchema),
          status: spanStatusSchema,
        })
        .strict(),
    ),
  })
  .strict()

const transformedFieldSchema = z
  .object({ sourcePath: z.string(), targetPath: z.string(), operation: z.string() })
  .strict()
const defaultedFieldSchema = z
  .object({ targetPath: z.string(), value: projectionScalarSchema, reason: z.string() })
  .strict()
const lossFieldSchema = z.object({ sourcePath: z.string(), reason: z.string() }).strict()
const lossListsShape = {
  transformedFields: z.array(transformedFieldSchema),
  defaultedFields: z.array(defaultedFieldSchema),
  droppedFields: z.array(lossFieldSchema),
  truncation: z.array(lossFieldSchema),
  redaction: z.array(lossFieldSchema),
  unsupported: z.array(lossFieldSchema),
} as const

const manifestProjectionSchema = z.discriminatedUnion("profile", [
  z
    .object({
      profile: z.literal("otel-genai"),
      specificationVersion: z.literal(trajectoryProjectionProfiles.otelGenAi.specificationVersion),
      schemaVersion: z.literal(1),
      recordCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      profile: z.literal("openinference"),
      specificationVersion: z.literal(
        trajectoryProjectionProfiles.openInference.specificationVersion,
      ),
      schemaVersion: z.literal(1),
      recordCount: z.number().int().nonnegative(),
    })
    .strict(),
])

export const trajectoryProjectionManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("trajectory-projection-mapping-loss-manifest"),
    manifestVersion: z.literal("trajectory-projection-manifest-v1"),
    source: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        atfFormatVersion: z.union([z.literal(1), z.literal(2)]),
        eventCount: z.number().int().nonnegative(),
      })
      .strict(),
    projection: manifestProjectionSchema,
    reconstruction: z.literal("not_supported"),
    identity: z
      .object({
        sourceHashPreserved: z.literal(true),
        generatedTraceIds: z.literal(false),
        generatedSpanIds: z.literal(false),
      })
      .strict(),
    document: z.object(lossListsShape).strict(),
    events: z.array(
      z
        .object({
          source: z
            .object({ pointerPath: z.string(), eventIndex: z.number().int().nonnegative() })
            .strict(),
          target: z.object({ pointerPath: z.string() }).strict(),
          ...lossListsShape,
        })
        .strict(),
    ),
  })
  .strict()

export type OtelGenAiProjection = z.infer<typeof otelGenAiProjectionSchema>
export type OpenInferenceProjection = z.infer<typeof openInferenceProjectionSchema>
export type TrajectoryProjectionManifest = z.infer<typeof trajectoryProjectionManifestSchema>
export type TrajectoryProjectionBundle = Readonly<{
  projection: OtelGenAiProjection | OpenInferenceProjection
  manifest: TrajectoryProjectionManifest
}>
