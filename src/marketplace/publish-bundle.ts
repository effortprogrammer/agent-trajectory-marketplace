import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import {
  ArchiveContractError,
  assertDatasetArchivePlan,
  datasetArchivePolicy,
  datasetManifestPath,
  datasetManifestSchema,
} from "./archive-contract"
import {
  aggregateCompensatedUsage,
  assessCompensatedUsage,
  hasSupportedPositiveUsage,
  type CompensatedUsageAssessment,
} from "./compensated-model-policy"
import {
  PublishBundleError,
  readBundleFile,
} from "./publish-bundle-file"
import type { PublishBundleReadOptions } from "./publish-bundle-file"
import { createCandidateFromExactBytes } from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"
import { readEntries } from "./publish-bundle-zip"
import { parseAdmissionJson } from "./json-preflight"
import { ResidualSecretScanError, assertNoResidualSecrets } from "./residual-secret-scan"
import {
  boundedRedactedString,
  harnessTraceDocumentSchema,
  sanitizeHarnessPayload,
} from "../trajectory/adapters/contract"

export { PublishBundleError } from "./publish-bundle-file"
export type { PublishBundleReadOptions } from "./publish-bundle-file"
export type PublishArtifactDescriptor = Readonly<{
  readonly byteCount: number
  readonly label: string
  readonly path: string
  readonly sha256: string
}>
export type PublishWireContractBundle = Readonly<{
  readonly archive: Buffer
  readonly artifacts: readonly PublishArtifactDescriptor[]
  readonly candidate: PublishCandidate
}>

class AdmittedPublishBundle {
  declare private readonly publishCapability: void

  constructor(
    readonly archive: Buffer,
    readonly candidate: PublishCandidate,
    readonly artifacts: readonly PublishArtifactDescriptor[],
  ) {}
}

export type PublishBundle = AdmittedPublishBundle

const invalid = (): never => { throw new PublishBundleError("invalid_bundle_request") }
const unsupportedModel = (): never => {
  throw new PublishBundleError("unsupported_model")
}
const admittedBundles = new WeakSet<PublishBundle>()

const assertTraceAdmission = (
  data: Buffer,
  enforceCompensatedModelPolicy: boolean,
): CompensatedUsageAssessment => {
  const input = parseAdmissionJson(data)
  if (input === undefined) return invalid()
  const parsed = harnessTraceDocumentSchema.safeParse(input)
  if (!parsed.success || parsed.data.events.length > datasetArchivePolicy.maxTraceEvents) return invalid()
  const usageAssessment = assessCompensatedUsage(parsed.data)
  if (
    enforceCompensatedModelPolicy
    && !usageAssessment.hasOnlySupportedUsage
  ) {
    return unsupportedModel()
  }
  const runtime = boundedRedactedString(parsed.data.runtime)
  if (runtime.truncated || runtime.text !== parsed.data.runtime) return invalid()
  for (const event of parsed.data.events) {
    const metadata = [
      event.kind,
      event.name,
      ...(event.sourceEventId === undefined ? [] : [event.sourceEventId]),
      ...(event.parentSourceEventId === undefined ? [] : [event.parentSourceEventId]),
    ]
    if (metadata.some((value) => {
      const sanitized = boundedRedactedString(value)
      return sanitized.truncated || sanitized.text !== value
    })) return invalid()
    if (event.payload === undefined) continue
    const sanitized = sanitizeHarnessPayload(event.payload)
    if (sanitized === undefined || !isDeepStrictEqual(sanitized, event.payload)) return invalid()
  }
  try {
    assertNoResidualSecrets(data)
  } catch (error) {
    if (error instanceof ResidualSecretScanError) return invalid()
    throw error
  }
  return usageAssessment
}

const admitPublishBundle = (bundle: PublishWireContractBundle): PublishBundle => {
  const admitted = new AdmittedPublishBundle(
    bundle.archive,
    bundle.candidate,
    bundle.artifacts,
  )
  Object.freeze(admitted)
  admittedBundles.add(admitted)
  return admitted
}

export const takePublishBundle = (
  bundle: PublishBundle,
): Readonly<{ readonly archive: Buffer; readonly candidate: PublishCandidate }> => {
  if (!admittedBundles.delete(bundle)) return invalid()
  return bundle
}

const inspectPublishBundle = (
  archive: Buffer,
  enforceCompensatedModelPolicy: boolean,
): PublishWireContractBundle => {
  if (archive.byteLength <= 0 || archive.byteLength > datasetArchivePolicy.maxArchiveBytes) return invalid()
  const entries = readEntries(archive)
  const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
  if (entriesByName.size !== entries.length) return invalid()
  const manifestEntry = entriesByName.get(datasetManifestPath)
  if (manifestEntry === undefined || manifestEntry.data.length > datasetArchivePolicy.maxManifestBytes) return invalid()
  const manifestInput = parseAdmissionJson(manifestEntry.data)
  if (manifestInput === undefined) return invalid()
  const manifest = datasetManifestSchema.safeParse(manifestInput)
  if (!manifest.success || entries.length !== manifest.data.artifacts.length + 1) return invalid()
  const expectedNames = [datasetManifestPath, ...manifest.data.artifacts.map((artifact) => artifact.path).sort()]
  if (entries.some((entry, index) => entry.name !== expectedNames[index])) return invalid()
  try {
    assertDatasetArchivePlan({
      archiveByteCount: archive.byteLength,
      entries: manifest.data.artifacts.map((artifact) => ({
        byteCount: artifact.byteCount,
        name: artifact.path,
      })),
      manifestByteCount: manifestEntry.data.length,
    })
  } catch (error) {
    if (error instanceof ArchiveContractError) return invalid()
    throw error
  }
  const usageAssessments: CompensatedUsageAssessment[] = []
  for (const artifact of manifest.data.artifacts) {
    const entry = entriesByName.get(artifact.path)
    if (entry === undefined || entry.data.length !== artifact.byteCount || createHash("sha256").update(entry.data).digest("hex") !== artifact.sha256) return invalid()
    const usageAssessment = assertTraceAdmission(
      entry.data,
      enforceCompensatedModelPolicy,
    )
    if (enforceCompensatedModelPolicy) usageAssessments.push(usageAssessment)
  }
  if (
    enforceCompensatedModelPolicy
    && !hasSupportedPositiveUsage(aggregateCompensatedUsage(usageAssessments))
  ) return unsupportedModel()
  return Object.freeze({
    archive,
    artifacts: Object.freeze(
      [...manifest.data.artifacts]
        .sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0))
        .map((artifact) => Object.freeze({ ...artifact })),
    ),
    candidate: Object.freeze(createCandidateFromExactBytes({
      archive,
      artifactCount: manifest.data.artifacts.length,
      manifest: manifestEntry.data,
    })),
  })
}

export const parsePublishBundle = (archive: Buffer): PublishBundle =>
  admitPublishBundle(inspectPublishBundle(archive, true))

export const parsePublishBundleForWireContract = (
  archive: Buffer,
): PublishWireContractBundle => inspectPublishBundle(archive, false)

export const readPublishBundle = (
  path: string,
  options: PublishBundleReadOptions = {},
): PublishBundle => parsePublishBundle(readBundleFile(path, options))
