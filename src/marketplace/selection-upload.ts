import { MarketplaceError } from "./error"
import type { PublishBundle } from "./publish-bundle"
import {
  encodeSelectionDocument,
  readSelectionDocument,
  selectionDocumentFromTraces,
} from "./selection-contract"
import { scanSessionSnapshot } from "./session-snapshot"
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
      trace.byteCount !== entry.byteCount
    ) throw new MarketplaceError("invalid_bundle_request")
    return trace
  })
  return writeCandidateBundle(snapshot, selected, outputPath)
}

export const approvedMembership = (bundle: PublishBundle, selectionPath: string): readonly string[] => {
  const document = readSelectionDocument(selectionPath)
  const approved = document.traces.map((trace) => trace.selector).sort()
  if (
    approved.length !== bundle.artifactSelectors.length ||
    approved.some((selector, index) => selector !== bundle.artifactSelectors[index])
  ) throw new MarketplaceError("invalid_bundle_request")
  return approved
}
