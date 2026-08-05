import { sanitizedArtifactDigest } from "./dataset-archive"
import { MarketplaceError } from "./error"
import type { PublishBundle } from "./publish-bundle"
import {
  encodeSelectionDocument,
  readSelectionDocument,
  selectionDocumentFromTraces,
} from "./selection-contract"
import { scanSessionSnapshot } from "./session-snapshot"
import { boundedRedactedString } from "../trajectory/adapters/contract"
import type { CandidateBundleResult } from "./bundle-service"
import { writeCandidateBundle } from "./bundle-service"

export const selectionPreviewJson = (root: string): string => {
  const snapshot = scanSessionSnapshot(root)
  return encodeSelectionDocument(selectionDocumentFromTraces(snapshot.root, snapshot.traces)).toString("utf8")
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
