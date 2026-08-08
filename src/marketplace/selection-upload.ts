import {
  ArchiveContractError,
  assertDatasetArchivePlan,
  datasetManifestPath,
  encodeDatasetManifest,
} from "./archive-contract"
import { sanitizedArtifactDigest } from "./dataset-archive"
import { MarketplaceError } from "./error"
import type { PublishBundle } from "./publish-bundle"
import {
  SelectionContractError,
  encodeSelectionDocument,
  readSelectionDocument,
  selectionDocumentFromTraces,
} from "./selection-contract"
import type { SelectionDocument } from "./selection-contract"
import { scanSessionSnapshot } from "./session-snapshot"
import { estimateZipBytes } from "./stored-zip"
import { boundedRedactedString } from "../trajectory/adapters/contract"
import type { CandidateBundleResult } from "./bundle-service"
import { writeCandidateBundle } from "./bundle-service"

const maximumSelectionBytes = 1024 * 1024

const invalidSelection = (): never => {
  throw new SelectionContractError("invalid_selection")
}

const assertSelectionBuildable = (document: SelectionDocument): void => {
  const artifacts = document.traces.map((trace) => ({
    byteCount: trace.artifactByteCount,
    label: trace.selector,
    path: `traces/${trace.selector}.atf.json`,
    sha256: trace.artifactSha256,
  }))
  try {
    const manifest = encodeDatasetManifest({ artifacts, formatVersion: 1 })
    assertDatasetArchivePlan({
      archiveByteCount: estimateZipBytes([
        { byteCount: manifest.byteLength, name: datasetManifestPath },
        ...artifacts.map((artifact) => ({ byteCount: artifact.byteCount, name: artifact.path })),
      ]),
      entries: artifacts.map((artifact) => ({ byteCount: artifact.byteCount, name: artifact.path })),
      manifestByteCount: manifest.byteLength,
    })
  } catch (error) {
    if (error instanceof ArchiveContractError) return invalidSelection()
    throw error
  }
}

export const selectionPreviewJson = (root: string): string => {
  const snapshot = scanSessionSnapshot(root)
  const document = selectionDocumentFromTraces(snapshot.root, snapshot.traces)
  assertSelectionBuildable(document)
  const encoded = encodeSelectionDocument(document)
  if (encoded.byteLength > maximumSelectionBytes) return invalidSelection()
  return encoded.toString("utf8")
}

export const writeBundleFromSelection = (
  root: string,
  selectionPath: string,
  outputPath: string,
): CandidateBundleResult => {
  const snapshot = scanSessionSnapshot(root)
  const document = readSelectionDocument(selectionPath)
  if (document.root !== snapshot.root) throw new MarketplaceError("invalid_bundle_request")
  const selected = document.traces.map((entry) => {
    const trace = snapshot.traces.find((candidate) => candidate.selector === entry.selector)
    if (
      trace === undefined ||
      trace.hash !== entry.sha256 ||
      trace.byteCount !== entry.byteCount ||
      trace.eventCount !== entry.eventCount ||
      trace.earliestTimestamp !== entry.earliestTimestamp ||
      boundedRedactedString(trace.runtime).text !== entry.runtime
    ) throw new MarketplaceError("invalid_bundle_request")
    const artifact = sanitizedArtifactDigest(trace.bytes)
    if (artifact.sha256 !== entry.artifactSha256 || artifact.byteCount !== entry.artifactByteCount) {
      throw new MarketplaceError("invalid_bundle_request")
    }
    return trace
  })
  return writeCandidateBundle(snapshot, selected, outputPath)
}

export const approvedMembership = (bundle: PublishBundle, selectionPath: string): readonly string[] => {
  const document = readSelectionDocument(selectionPath)
  const approved = [...document.traces].sort((left, right) =>
    left.selector < right.selector ? -1 : left.selector > right.selector ? 1 : 0)
  if (
    approved.length !== bundle.artifacts.length ||
    approved.some((trace, index) => {
      const artifact = bundle.artifacts[index]
      return artifact === undefined ||
        trace.selector !== artifact.label ||
        trace.artifactSha256 !== artifact.sha256 ||
        trace.artifactByteCount !== artifact.byteCount
    })
  ) throw new MarketplaceError("invalid_bundle_request")
  return approved.map((trace) => trace.selector)
}
