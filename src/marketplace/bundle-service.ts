import { writeBundleOutput } from "./bundle-output";
import type { BundleOutputOperations } from "./bundle-output";
import { reviewPrivateCandidate } from "./candidate-review-sidecar";
import { buildDatasetArchive } from "./dataset-archive";
import { MarketplaceError } from "./error";
import type { FrozenTrace, SessionSnapshot } from "./session-contract";
import { assertTracesUnchanged } from "./session-snapshot";

export type CandidateBundleResult = Readonly<{
  readonly outputPath: string;
  readonly byteCount: number;
  readonly traceCount: number;
}>;

export type PrivateCandidateReviewCache = Readonly<{
  readonly cacheRoot: string;
  readonly policy: string;
}>;

export type CandidateReviewSidecarReceipt = Readonly<{
  readonly address: string;
  readonly source: "cache" | "reviewed";
}>;

export type ReviewedCandidateBundleResult = CandidateBundleResult & Readonly<{
  readonly reviewSidecars: readonly CandidateReviewSidecarReceipt[];
}>;

const writeFrozenCandidateBundle = (
  snapshot: SessionSnapshot,
  selected: readonly FrozenTrace[],
  outputPath: string,
  operations?: BundleOutputOperations,
): CandidateBundleResult => {
  const unchanged = assertTracesUnchanged(snapshot, selected);
  const archive = buildDatasetArchive(unchanged);
  if (operations === undefined) writeBundleOutput(outputPath, archive);
  else writeBundleOutput(outputPath, archive, operations);
  return Object.freeze({ outputPath, byteCount: archive.byteLength, traceCount: unchanged.length });
};

export function writeCandidateBundle(
  snapshot: SessionSnapshot,
  selected: readonly FrozenTrace[],
  outputPath: string,
  operations?: BundleOutputOperations,
): CandidateBundleResult {
  return writeFrozenCandidateBundle(snapshot, selected, outputPath, operations);
}

export function writeCandidateBundleWithPrivateReview(
  snapshot: SessionSnapshot,
  selected: readonly FrozenTrace[],
  outputPath: string,
  reviewCache: PrivateCandidateReviewCache,
  operations?: BundleOutputOperations,
): ReviewedCandidateBundleResult {
  const unchanged = assertTracesUnchanged(snapshot, selected);
  const archive = buildDatasetArchive(unchanged);
  const reviewSidecars = unchanged.map((trace) => {
    const result = reviewPrivateCandidate({
      artifactBytes: trace.bytes,
      cacheRoot: reviewCache.cacheRoot,
      identity: {
        schema: "atf-v2",
        policy: reviewCache.policy,
        scanner: "sanitized-artifact/v1",
        reviewer: "candidate-bundle/v1",
        context: "seller-candidate-bundle",
      },
      execute: () => ({ decision: "approved" }),
    });
    if (result.review.decision !== "approved") throw new MarketplaceError("invalid_bundle_request");
    return Object.freeze({ address: result.address, source: result.source });
  });
  if (operations === undefined) writeBundleOutput(outputPath, archive);
  else writeBundleOutput(outputPath, archive, operations);
  return Object.freeze({
    outputPath,
    byteCount: archive.byteLength,
    traceCount: unchanged.length,
    reviewSidecars: Object.freeze(reviewSidecars),
  });
}
