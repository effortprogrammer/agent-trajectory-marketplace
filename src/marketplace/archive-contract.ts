import { z } from "zod"

export const datasetArchivePolicy = {
  maxTraces: 100,
  maxTraceEvents: 65_536,
  maxTraceBytes: 64 * 1024 * 1024,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxTotalUncompressedBytes: 2048 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
} as const

export const datasetManifestPath = "dataset-manifest.json"

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const selectorSchema = z.string().regex(/^s-[0-9a-f]{64}$/)
export const datasetTracePathSchema = z.string().regex(/^traces\/s-[0-9a-f]{64}\.atf\.json$/)

export const datasetArtifactSchema = z
  .object({
    path: datasetTracePathSchema,
    label: selectorSchema,
    sha256: sha256Schema,
    byteCount: z.number().int().positive().max(datasetArchivePolicy.maxTraceBytes),
  })
  .strict()

export const datasetManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    artifacts: z.array(datasetArtifactSchema).min(1).max(datasetArchivePolicy.maxTraces),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = new Set<string>()
    const hashes = new Set<string>()
    for (const artifact of manifest.artifacts) {
      const expectedPath = `traces/${artifact.label}.atf.json`
      if (artifact.path !== expectedPath) {
        context.addIssue({ code: "custom", message: "artifact label must match its opaque path" })
      }
      if (paths.has(artifact.path)) {
        context.addIssue({ code: "custom", message: "artifact paths must be unique" })
      }
      if (hashes.has(artifact.sha256)) {
        context.addIssue({ code: "custom", message: "artifact hashes must be unique" })
      }
      paths.add(artifact.path)
      hashes.add(artifact.sha256)
    }
  })

export type DatasetManifest = Readonly<{
  formatVersion: 1
  artifacts: readonly Readonly<{
    path: string
    label: string
    sha256: string
    byteCount: number
  }>[]
}>

const archivePlanSchema = z
  .object({
    manifestByteCount: z.number().int().positive().max(datasetArchivePolicy.maxManifestBytes),
    archiveByteCount: z.number().int().positive().max(datasetArchivePolicy.maxArchiveBytes),
    entries: z
      .array(
        z
          .object({
            name: datasetTracePathSchema,
            byteCount: z.number().int().positive().max(datasetArchivePolicy.maxTraceBytes),
          })
          .strict(),
      )
      .min(1)
      .max(datasetArchivePolicy.maxTraces),
  })
  .strict()

export class ArchiveContractError extends Error {
  public constructor(public readonly reason: "invalid_manifest" | "invalid_archive_plan" | "manifest_too_large") {
    super(reason)
    this.name = "ArchiveContractError"
  }
}

export const assertDatasetArchivePlan = (input: unknown): void => {
  const parsed = archivePlanSchema.safeParse(input)
  if (!parsed.success) throw new ArchiveContractError("invalid_archive_plan")

  const names = new Set<string>()
  let totalUncompressedBytes = parsed.data.manifestByteCount
  for (const entry of parsed.data.entries) {
    if (names.has(entry.name)) throw new ArchiveContractError("invalid_archive_plan")
    names.add(entry.name)
    totalUncompressedBytes += entry.byteCount
    if (totalUncompressedBytes > datasetArchivePolicy.maxTotalUncompressedBytes) {
      throw new ArchiveContractError("invalid_archive_plan")
    }
  }
}

export const encodeDatasetManifest = (input: unknown): Buffer => {
  const parsed = datasetManifestSchema.safeParse(input)
  if (!parsed.success) throw new ArchiveContractError("invalid_manifest")
  const encoded = Buffer.from(`${JSON.stringify(parsed.data, null, 2)}\n`, "utf8")
  if (encoded.length > datasetArchivePolicy.maxManifestBytes) {
    throw new ArchiveContractError("manifest_too_large")
  }
  return encoded
}
