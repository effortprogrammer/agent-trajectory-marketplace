import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import {
  ArchiveContractError,
  assertDatasetArchivePlan,
  datasetArchivePolicy,
  datasetManifestPath,
  datasetManifestSchema,
} from "./archive-contract"
import { hasOnlyCompensatedModelUsage } from "./compensated-model-policy"
import {
  PublishBundleError,
  readBundleFile,
} from "./publish-bundle-file"
import type { PublishBundleReadOptions } from "./publish-bundle-file"
import { createCandidateFromExactBytes } from "./publish-contract"
import type { PublishCandidate } from "./publish-contract"
import { crc32 } from "./zip-crc32"
import { parseAdmissionJson } from "./json-preflight"
import { ResidualSecretScanError, assertNoResidualSecrets } from "./residual-secret-scan"
import {
  boundedRedactedString,
  harnessTraceDocumentSchema,
  sanitizeHarnessPayload,
} from "../trajectory/adapters/contract"

const localHeader = 0x04034b50
const centralHeader = 0x02014b50
const endHeader = 0x06054b50
const endBytes = 22
const maxEntryCount = datasetArchivePolicy.maxTraces + 1

export { PublishBundleError } from "./publish-bundle-file"
export type { PublishBundleReadOptions } from "./publish-bundle-file"

type BundleEntry = Readonly<{
  readonly crc32: number
  readonly data: Buffer
  readonly name: string
  readonly nameBytes: Buffer
  readonly offset: number
}>
declare const publishBundleBrand: unique symbol
export type PublishArtifactDescriptor = Readonly<{
  readonly byteCount: number
  readonly label: string
  readonly path: string
  readonly sha256: string
}>
export type PublishBundle = Readonly<{
  readonly archive: Buffer
  readonly artifacts: readonly PublishArtifactDescriptor[]
  readonly candidate: PublishCandidate
  readonly [publishBundleBrand]: true
}>

const invalid = (): never => { throw new PublishBundleError("invalid_bundle_request") }
const unsupportedModel = (): never => {
  throw new PublishBundleError("unsupported_model")
}
const admittedBundles = new WeakSet<PublishBundle>()

const readEntries = (archive: Buffer): readonly BundleEntry[] => {
  const endOffset = archive.length - endBytes
  if (archive.length < endBytes || archive.readUInt32LE(endOffset) !== endHeader) return invalid()
  const disk = archive.readUInt16LE(endOffset + 4)
  const centralDisk = archive.readUInt16LE(endOffset + 6)
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8)
  const expectedCount = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)
  const commentLength = archive.readUInt16LE(endOffset + 20)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== expectedCount ||
    expectedCount === 0 ||
    expectedCount > maxEntryCount ||
    commentLength !== 0
  ) return invalid()
  if (centralOffset > endOffset || centralSize !== endOffset - centralOffset) return invalid()
  const entries: BundleEntry[] = []
  let offset = 0
  while (offset < centralOffset) {
    if (entries.length >= expectedCount) return invalid()
    if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== localHeader) return invalid()
    const version = archive.readUInt16LE(offset + 4)
    const flags = archive.readUInt16LE(offset + 6)
    const compression = archive.readUInt16LE(offset + 8)
    const modificationTime = archive.readUInt16LE(offset + 10)
    const modificationDate = archive.readUInt16LE(offset + 12)
    const checksum = archive.readUInt32LE(offset + 14)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const size = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    if (
      version !== 20 ||
      flags !== 0 ||
      compression !== 0 ||
      modificationTime !== 0 ||
      modificationDate !== 0 ||
      compressedSize !== size ||
      extraLength !== 0
    ) return invalid()
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + size
    if (dataEnd > centralOffset) return invalid()
    const nameBytes = archive.subarray(nameStart, nameStart + nameLength)
    let name: string
    try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes) } catch { return invalid() }
    if (name.length === 0 || name.includes("\\") || name.split("/").some((part) => part === "" || part === "." || part === "..")) return invalid()
    const data = archive.subarray(dataStart, dataEnd)
    if (crc32(data) !== checksum) return invalid()
    const entry = { crc32: checksum, data, name, nameBytes, offset }
    entries.push(entry)
    offset = dataEnd
  }
  let centralPosition = centralOffset
  for (let index = 0; index < expectedCount; index += 1) {
    if (centralPosition + 46 > endOffset || archive.readUInt32LE(centralPosition) !== centralHeader) return invalid()
    const madeByVersion = archive.readUInt16LE(centralPosition + 4)
    const requiredVersion = archive.readUInt16LE(centralPosition + 6)
    const flags = archive.readUInt16LE(centralPosition + 8)
    const compression = archive.readUInt16LE(centralPosition + 10)
    const modificationTime = archive.readUInt16LE(centralPosition + 12)
    const modificationDate = archive.readUInt16LE(centralPosition + 14)
    const checksum = archive.readUInt32LE(centralPosition + 16)
    const compressedSize = archive.readUInt32LE(centralPosition + 20)
    const size = archive.readUInt32LE(centralPosition + 24)
    const nameLength = archive.readUInt16LE(centralPosition + 28)
    const extraLength = archive.readUInt16LE(centralPosition + 30)
    const commentLength = archive.readUInt16LE(centralPosition + 32)
    const diskStart = archive.readUInt16LE(centralPosition + 34)
    const internalAttributes = archive.readUInt16LE(centralPosition + 36)
    const externalAttributes = archive.readUInt32LE(centralPosition + 38)
    const localOffset = archive.readUInt32LE(centralPosition + 42)
    if (
      madeByVersion !== 20 ||
      requiredVersion !== 20 ||
      flags !== 0 ||
      compression !== 0 ||
      modificationTime !== 0 ||
      modificationDate !== 0 ||
      compressedSize !== size ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      diskStart !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== 0
    ) return invalid()
    const nameBytes = archive.subarray(centralPosition + 46, centralPosition + 46 + nameLength)
    let name: string
    try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes) } catch { return invalid() }
    const local = entries[index]
    if (
      local === undefined ||
      local.offset !== localOffset ||
      local.name !== name ||
      !local.nameBytes.equals(nameBytes) ||
      local.data.length !== size ||
      local.crc32 !== checksum
    ) return invalid()
    centralPosition += 46 + nameLength + extraLength + commentLength
  }
  if (centralPosition !== endOffset) return invalid()
  if (entries.length !== expectedCount) return invalid()
  return entries
}

const assertTraceAdmission = (
  data: Buffer,
  enforceCompensatedModelPolicy: boolean,
): void => {
  const input = parseAdmissionJson(data)
  if (input === undefined) return invalid()
  const parsed = harnessTraceDocumentSchema.safeParse(input)
  if (!parsed.success || parsed.data.events.length > datasetArchivePolicy.maxTraceEvents) return invalid()
  if (
    enforceCompensatedModelPolicy
    && !hasOnlyCompensatedModelUsage(parsed.data)
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
}

const admitPublishBundle = (archive: Buffer, candidate: PublishCandidate, artifacts: readonly PublishArtifactDescriptor[]): PublishBundle => {
  const bundle = Object.freeze({
    archive,
    artifacts: Object.freeze(
      [...artifacts]
        .sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0))
        .map((artifact) => Object.freeze({ ...artifact })),
    ),
    candidate: Object.freeze(candidate),
  }) as PublishBundle
  admittedBundles.add(bundle)
  return bundle
}

export const takePublishBundle = (
  bundle: PublishBundle,
): Readonly<{ readonly archive: Buffer; readonly candidate: PublishCandidate }> => {
  if (!admittedBundles.delete(bundle)) return invalid()
  return bundle
}

const parsePublishBundleWithPolicy = (
  archive: Buffer,
  enforceCompensatedModelPolicy: boolean,
): PublishBundle => {
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
  for (const artifact of manifest.data.artifacts) {
    const entry = entriesByName.get(artifact.path)
    if (entry === undefined || entry.data.length !== artifact.byteCount || createHash("sha256").update(entry.data).digest("hex") !== artifact.sha256) return invalid()
    assertTraceAdmission(entry.data, enforceCompensatedModelPolicy)
  }
  return admitPublishBundle(
    archive,
    createCandidateFromExactBytes({
      archive,
      artifactCount: manifest.data.artifacts.length,
      manifest: manifestEntry.data,
    }),
    manifest.data.artifacts,
  )
}

export const parsePublishBundle = (archive: Buffer): PublishBundle =>
  parsePublishBundleWithPolicy(archive, true)

export const parsePublishBundleForWireContract = (
  archive: Buffer,
): PublishBundle => parsePublishBundleWithPolicy(archive, false)

export const readPublishBundle = (
  path: string,
  options: PublishBundleReadOptions = {},
): PublishBundle => parsePublishBundle(readBundleFile(path, options))
