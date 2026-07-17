import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import { resolveReadableProjectPath, resolveWritableProjectPath } from "./path-safety"
import {
  openInferenceProjectionSchema,
  otelGenAiProjectionSchema,
  type TrajectoryProjectionBundle,
  trajectoryProjectionManifestSchema,
  trajectoryProjectionProfileNames,
} from "./projection-contract"
import { buildTrajectoryProjection } from "./projection-mapper"

export type {
  OpenInferenceProjection,
  OtelGenAiProjection,
  TrajectoryProjectionBundle,
  TrajectoryProjectionManifest,
  TrajectoryProjectionProfileName,
} from "./projection-contract"
export {
  openInferenceProjectionSchema,
  otelGenAiProjectionSchema,
  trajectoryProjectionManifestSchema,
  trajectoryProjectionProfileNames,
  trajectoryProjectionProfiles,
} from "./projection-contract"

const createProjectionInputSchema = z
  .object({
    profile: z.enum(trajectoryProjectionProfileNames),
    sourceBytes: z.instanceof(Uint8Array),
  })
  .strict()

const exportProjectionInputSchema = z
  .object({
    profile: z.enum(trajectoryProjectionProfileNames),
    tracePath: z.string().min(1),
    outDir: z.string().min(1),
  })
  .strict()

export const TrajectoryProjectionErrorCode = {
  InvalidRequest: "invalid_projection_request",
  InvalidSourcePath: "invalid_projection_source_path",
  InvalidOutputPath: "invalid_projection_output_path",
  MissingSource: "missing_projection_source",
} as const

export type TrajectoryProjectionErrorCode =
  (typeof TrajectoryProjectionErrorCode)[keyof typeof TrajectoryProjectionErrorCode]

export class TrajectoryProjectionError extends Error {
  readonly name = "TrajectoryProjectionError"
  readonly code: TrajectoryProjectionErrorCode

  constructor(code: TrajectoryProjectionErrorCode) {
    super(code)
    this.code = code
  }
}

const invalidPath = (code: TrajectoryProjectionErrorCode): never => {
  throw new TrajectoryProjectionError(code)
}

const parseCreateInput = (input: unknown) => {
  const parsed = createProjectionInputSchema.safeParse(input)
  if (!parsed.success)
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.InvalidRequest)
  return parsed.data
}

export const createTrajectoryProjection = (input: unknown): TrajectoryProjectionBundle => {
  const parsed = parseCreateInput(input)
  const result = buildTrajectoryProjection(parsed.profile, parsed.sourceBytes)
  trajectoryProjectionManifestSchema.parse(result.manifest)
  if (parsed.profile === "otel-genai") otelGenAiProjectionSchema.parse(result.projection)
  else openInferenceProjectionSchema.parse(result.projection)
  return result
}

const isUri = (value: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)

const localSourcePath = (inputPath: string): string => {
  if (isUri(inputPath) || !inputPath.endsWith(".atf.json")) {
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.InvalidSourcePath)
  }
  const tracePath = resolveReadableProjectPath({
    inputPath,
    code: TrajectoryProjectionErrorCode.InvalidSourcePath,
    throwPathError: (code) => invalidPath(code),
  })
  if (!existsSync(tracePath) || !statSync(tracePath).isFile()) {
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.MissingSource)
  }
  return tracePath
}

const localOutputDir = (inputPath: string): string => {
  if (isUri(inputPath)) {
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.InvalidOutputPath)
  }
  const outDir = resolveWritableProjectPath({
    inputPath,
    code: TrajectoryProjectionErrorCode.InvalidOutputPath,
    throwPathError: (code) => invalidPath(code),
  })
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) {
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.InvalidOutputPath)
  }
  return outDir
}

const sha256Text = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex")

export const exportTrajectoryProjection = (input: unknown) => {
  const parsed = exportProjectionInputSchema.safeParse(input)
  if (!parsed.success)
    throw new TrajectoryProjectionError(TrajectoryProjectionErrorCode.InvalidRequest)
  const tracePath = localSourcePath(parsed.data.tracePath)
  const outDir = localOutputDir(parsed.data.outDir)
  const result = createTrajectoryProjection({
    profile: parsed.data.profile,
    sourceBytes: readFileSync(tracePath),
  })
  const projectionText = `${JSON.stringify(result.projection, null, 2)}\n`
  const manifestText = `${JSON.stringify(result.manifest, null, 2)}\n`
  const projectionPath = join(outDir, "projection.json")
  const manifestPath = join(outDir, "mapping-loss-manifest.json")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(projectionPath, projectionText, "utf8")
  writeFileSync(manifestPath, manifestText, "utf8")
  return {
    profile: parsed.data.profile,
    profileVersion: result.manifest.projection.specificationVersion,
    sourceSha256: result.manifest.source.sha256,
    sourceFormatVersion: result.manifest.source.atfFormatVersion,
    eventCount: result.manifest.source.eventCount,
    projectionPath,
    manifestPath,
    projectionSha256: sha256Text(projectionText),
    manifestSha256: sha256Text(manifestText),
  }
}
