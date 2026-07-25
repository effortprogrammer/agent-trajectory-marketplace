import { createHash } from "node:crypto";

import {
  ArchiveContractError,
  datasetArchivePolicy,
  datasetManifestPath,
  encodeDatasetManifest,
} from "./archive-contract";
import { MarketplaceError } from "./error";
import type { FrozenTrace } from "./session-contract";
import { StoredZipError, writeDatasetZip } from "./stored-zip";
import type { StoredZipEntry } from "./stored-zip";

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function buildDatasetArchive(selected: readonly FrozenTrace[]): Buffer {
  if (selected.length === 0) throw new MarketplaceError("empty_selection");
  if (selected.length > datasetArchivePolicy.maxTraces) {
    throw new MarketplaceError("invalid_bundle_request");
  }

  const selectors = new Set<string>();
  const hashes = new Set<string>();
  const traces = [...selected].sort((left, right) =>
    left.selector < right.selector ? -1 : left.selector > right.selector ? 1 : 0,
  );
  const entries: StoredZipEntry[] = [];
  const artifacts = traces.map((trace) => {
    if (selectors.has(trace.selector) || hashes.has(trace.hash)) {
      throw new MarketplaceError("duplicate_trace");
    }
    selectors.add(trace.selector);
    hashes.add(trace.hash);
    const bytes = Buffer.from(trace.bytes);
    const sha256 = digest(bytes);
    if (bytes.length !== trace.byteCount || sha256 !== trace.hash) {
      throw new MarketplaceError("trace_drift");
    }
    if (bytes.length === 0 || bytes.length > datasetArchivePolicy.maxTraceBytes) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    const path = `traces/${trace.selector}.atf.json`;
    entries.push({ name: path, data: bytes });
    return { path, label: trace.selector, sha256, byteCount: bytes.length };
  });

  try {
    const manifest = encodeDatasetManifest({ formatVersion: 1, artifacts });
    return writeDatasetZip([
      { name: datasetManifestPath, data: manifest },
      ...entries,
    ]);
  } catch (error) {
    if (error instanceof ArchiveContractError || error instanceof StoredZipError) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    throw error;
  }
}
