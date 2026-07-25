import { writeBundleOutput } from "./bundle-output";
import type { BundleOutputOperations } from "./bundle-output";
import { buildDatasetArchive } from "./dataset-archive";
import type { FrozenTrace, SessionSnapshot } from "./session-contract";
import { assertTracesUnchanged } from "./session-snapshot";

export type CandidateBundleResult = Readonly<{
  readonly outputPath: string;
  readonly byteCount: number;
  readonly traceCount: number;
}>;

export function writeCandidateBundle(
  snapshot: SessionSnapshot,
  selected: readonly FrozenTrace[],
  outputPath: string,
  operations?: BundleOutputOperations,
): CandidateBundleResult {
  const unchanged = assertTracesUnchanged(snapshot, selected);
  const archive = buildDatasetArchive(unchanged);
  if (operations === undefined) writeBundleOutput(outputPath, archive);
  else writeBundleOutput(outputPath, archive, operations);
  return Object.freeze({ outputPath, byteCount: archive.byteLength, traceCount: unchanged.length });
}
