import { z } from "zod"

import { observationSetValidationIssues } from "./observation-set-validator"

export const trajectoryObservationPolicy = {
  maxArtifacts: 100,
  maxArtifactBytes: 64 * 1024 * 1024,
  maxArtifactPathChars: 512,
  maxEventsPerArtifact: 100_000,
  maxTotalObservations: 250_000,
  maxJsonDepth: 32,
  maxJsonNodes: 1_000_000,
  maxRuntimeChars: 256,
  maxStatusChars: 128,
  maxEventKindChars: 64,
  maxEventNameChars: 512,
  maxDetailBytes: 64 * 1024,
  maxToolUseIdChars: 512,
  maxPayloadStringBytes: 16 * 1024,
  maxPayloadSerializedBytes: 64 * 1024,
  maxAssistantBlocks: 1_024,
} as const

export const trajectoryObservationSchemaVersion = 1 as const
export const trajectoryObservationNormalizerVersion = "atf-observation-v1" as const

export const observationArchiveSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("ArchiveSha256")
export const observationArtifactSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("ArtifactSha256")
export const observationArtifactPathSchema = z
  .string()
  .max(trajectoryObservationPolicy.maxArtifactPathChars)
  .regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.atf\.json$/)
  .brand("AtfArtifactPath")
export const observationIdSchema = z
  .string()
  .regex(/^obs_[a-f0-9]{64}$/)
  .brand("TrajectoryObservationId")

export type ArchiveSha256 = z.infer<typeof observationArchiveSha256Schema>
export type ArtifactSha256 = z.infer<typeof observationArtifactSha256Schema>
export type AtfArtifactPath = z.infer<typeof observationArtifactPathSchema>
export type TrajectoryObservationId = z.infer<typeof observationIdSchema>

export const trajectoryObservationEventClasses = [
  "session",
  "step",
  "llm",
  "tool_call",
  "tool_result",
  "verification",
  "error",
  "other",
] as const
export type TrajectoryObservationEventClass = (typeof trajectoryObservationEventClasses)[number]
export const trajectoryObservationFunctionDirections = ["enter", "exit", "not_applicable"] as const
export type TrajectoryObservationFunctionDirection =
  (typeof trajectoryObservationFunctionDirections)[number]

export type TrajectoryObservationToolLink =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "matched"; counterpartObservationId: TrajectoryObservationId }>
  | Readonly<{
      status: "invalid"
      reason: "unmatched_call" | "unmatched_result" | "result_before_call" | "name_mismatch"
    }>

export type TrajectoryObservationErrorAvailability =
  | Readonly<{ availability: "not_applicable" }>
  | Readonly<{ availability: "unavailable" }>
  | Readonly<{ availability: "available"; outcome: "error" | "success" }>

export type TrajectoryObservationVerificationAvailability =
  | Readonly<{ availability: "not_applicable" }>
  | Readonly<{ availability: "unavailable" }>
  | Readonly<{ availability: "available"; outcome: "passed" | "failed" }>

export type TrajectoryObservationSource = Readonly<{
  archiveSha256: ArchiveSha256
  artifactPath: AtfArtifactPath
  artifactSha256: ArtifactSha256
  eventIndex: number
}>

export type TrajectoryObservation = Readonly<{
  id: TrajectoryObservationId
  ordinal: number
  source: TrajectoryObservationSource
  eventClass: TrajectoryObservationEventClass
  functionDirection: TrajectoryObservationFunctionDirection
  toolUseLink: TrajectoryObservationToolLink
  error: TrajectoryObservationErrorAvailability
  verification: TrajectoryObservationVerificationAvailability
}>

export type TrajectoryObservationSummary = Readonly<{
  artifactCount: number
  observationCount: number
  atfVersionCounts: Readonly<{ v1: number; v2: number }>
}>

export type TrajectoryObservationSet = Readonly<{
  schemaVersion: typeof trajectoryObservationSchemaVersion
  normalizerVersion: typeof trajectoryObservationNormalizerVersion
  summary: TrajectoryObservationSummary
  observations: readonly TrajectoryObservation[]
}>

export const trajectoryObservationSourceSchema = z
  .object({
    archiveSha256: observationArchiveSha256Schema,
    artifactPath: observationArtifactPathSchema,
    artifactSha256: observationArtifactSha256Schema,
    eventIndex: z
      .number()
      .int()
      .nonnegative()
      .max(trajectoryObservationPolicy.maxEventsPerArtifact - 1),
  })
  .strict()

const toolUseLinkSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_applicable") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
  z
    .object({ status: z.literal("matched"), counterpartObservationId: observationIdSchema })
    .strict(),
  z
    .object({
      status: z.literal("invalid"),
      reason: z.enum(["unmatched_call", "unmatched_result", "result_before_call", "name_mismatch"]),
    })
    .strict(),
])

const errorAvailabilitySchema = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("not_applicable") }).strict(),
  z.object({ availability: z.literal("unavailable") }).strict(),
  z
    .object({ availability: z.literal("available"), outcome: z.enum(["error", "success"]) })
    .strict(),
])

const verificationAvailabilitySchema = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("not_applicable") }).strict(),
  z.object({ availability: z.literal("unavailable") }).strict(),
  z
    .object({ availability: z.literal("available"), outcome: z.enum(["passed", "failed"]) })
    .strict(),
])

export const trajectoryObservationSchema = z
  .object({
    id: observationIdSchema,
    ordinal: z
      .number()
      .int()
      .nonnegative()
      .max(trajectoryObservationPolicy.maxTotalObservations - 1),
    source: trajectoryObservationSourceSchema,
    eventClass: z.enum(trajectoryObservationEventClasses),
    functionDirection: z.enum(trajectoryObservationFunctionDirections),
    toolUseLink: toolUseLinkSchema,
    error: errorAvailabilitySchema,
    verification: verificationAvailabilitySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasFunctionDirection = value.functionDirection !== "not_applicable"
    if ((value.eventClass === "step") !== hasFunctionDirection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["functionDirection"],
        message: "function direction does not match event class",
      })
    }
  })

const summarySchema = z
  .object({
    artifactCount: z.number().int().min(1).max(trajectoryObservationPolicy.maxArtifacts),
    observationCount: z
      .number()
      .int()
      .nonnegative()
      .max(trajectoryObservationPolicy.maxTotalObservations),
    atfVersionCounts: z
      .object({
        v1: z.number().int().nonnegative().max(trajectoryObservationPolicy.maxArtifacts),
        v2: z.number().int().nonnegative().max(trajectoryObservationPolicy.maxArtifacts),
      })
      .strict(),
  })
  .strict()

export const trajectoryObservationSetSchema = z
  .object({
    schemaVersion: z.literal(trajectoryObservationSchemaVersion),
    normalizerVersion: z.literal(trajectoryObservationNormalizerVersion),
    summary: summarySchema,
    observations: z
      .array(trajectoryObservationSchema)
      .max(trajectoryObservationPolicy.maxTotalObservations),
  })
  .strict()
  .superRefine((value, context) => {
    for (const issue of observationSetValidationIssues(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...issue.path],
        message: issue.message,
      })
    }
  })
