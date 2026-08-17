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
  allowedCandidates,
  isDeniedCandidate,
  readCandidateDenyPolicy,
  searchCandidates,
} from "./candidate-deny-policy"
import {
  SelectionContractError,
  encodeSelectionDocument,
  readSelectionDocument,
  selectionDocumentMaximumBytes,
  selectionDocumentFromTraces,
} from "./selection-contract"
import type { SelectionDocument } from "./selection-contract"
import { scanSessionSnapshot } from "./session-snapshot"
import type { FrozenTrace } from "./session-contract"
import { estimateZipBytes } from "./stored-zip"
import { boundedRedactedString } from "../trajectory/adapters/contract"
import type { CandidateBundleResult } from "./bundle-service"
import { writeCandidateBundle } from "./bundle-service"

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

export const allowedCandidateTraces = (
  _root: string,
  traces: readonly FrozenTrace[],
  denyPolicyPath?: string,
): readonly FrozenTrace[] => {
  if (denyPolicyPath === undefined) return traces
  const policy = readCandidateDenyPolicy(denyPolicyPath)
  return allowedCandidates(traces, policy)
}

export const selectionPreviewJson = (root: string, denyPolicyPath?: string): string => {
  const snapshot = scanSessionSnapshot(root)
  const filteredTraces = allowedCandidateTraces(snapshot.root, snapshot.traces, denyPolicyPath)
  const filtered = selectionDocumentFromTraces(snapshot.root, filteredTraces)
  assertSelectionBuildable(filtered)
  const encoded = encodeSelectionDocument(filtered)
  if (encoded.byteLength > selectionDocumentMaximumBytes) return invalidSelection()
  return encoded.toString("utf8")
}

export const writeBundleFromSelection = (
  root: string,
  selectionPath: string,
  outputPath: string,
  denyPolicyPath?: string,
): CandidateBundleResult => {
  const snapshot = scanSessionSnapshot(root)
  const policy = denyPolicyPath === undefined ? undefined : readCandidateDenyPolicy(denyPolicyPath)
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
      || trace.runtimeAttribution !== entry.runtimeAttribution
    ) throw new MarketplaceError("invalid_bundle_request")
    const artifact = sanitizedArtifactDigest(trace.bytes)
    if (artifact.sha256 !== entry.artifactSha256 || artifact.byteCount !== entry.artifactByteCount) {
      throw new MarketplaceError("invalid_bundle_request")
    }
    return trace
  })
  if (
    policy !== undefined &&
    selected.some((trace) => isDeniedCandidate(trace, policy))
  ) {
    throw new MarketplaceError("denied_selection")
  }
  return writeCandidateBundle(snapshot, selected, outputPath)
}

export const candidateSearchJson = (root: string, query: string, denyPolicyPath?: string): string => {
  const snapshot = scanSessionSnapshot(root)
  const policy = denyPolicyPath === undefined ? undefined : readCandidateDenyPolicy(denyPolicyPath)
  const matches = searchCandidates(snapshot.traces, query, policy)
  return JSON.stringify({ count: matches.length, selectors: matches.map((trace) => trace.selector) })
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
