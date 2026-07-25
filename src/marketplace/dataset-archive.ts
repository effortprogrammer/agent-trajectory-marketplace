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
import {
  boundedRedactedString,
  harnessTraceDocumentSchema,
  sanitizeHarnessPayload,
} from "../trajectory/adapters/contract";

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const sanitizedTraceBytes = (bytes: Uint8Array): Buffer => {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    throw error;
  }
  const parsed = harnessTraceDocumentSchema.safeParse(value);
  if (!parsed.success) throw new MarketplaceError("invalid_bundle_request");
  const events = parsed.data.events.map((event) => {
    const payload = event.payload === undefined ? undefined : sanitizeHarnessPayload(event.payload);
    if (event.payload !== undefined && payload === undefined) {
      throw new MarketplaceError("invalid_bundle_request");
    }
    return {
      kind: boundedRedactedString(event.kind).text,
      name: boundedRedactedString(event.name).text,
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
      ...(event.sourceEventId === undefined
        ? {}
        : { sourceEventId: boundedRedactedString(event.sourceEventId).text }),
      ...(event.parentSourceEventId === undefined
        ? {}
        : { parentSourceEventId: boundedRedactedString(event.parentSourceEventId).text }),
      ...(payload === undefined ? {} : { payload }),
    };
  });
  const sanitized = harnessTraceDocumentSchema.safeParse({
    runtime: boundedRedactedString(parsed.data.runtime).text,
    status: parsed.data.status,
    ...(parsed.data.formatVersion === undefined ? {} : { formatVersion: parsed.data.formatVersion }),
    eventCount: parsed.data.eventCount,
    events,
  });
  if (!sanitized.success) throw new MarketplaceError("invalid_bundle_request");
  return Buffer.from(JSON.stringify(sanitized.data), "utf8");
};

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
    const sourceBytes = Buffer.from(trace.bytes);
    const sourceHash = digest(sourceBytes);
    if (sourceBytes.length !== trace.byteCount || sourceHash !== trace.hash) {
      throw new MarketplaceError("trace_drift");
    }
    const bytes = sanitizedTraceBytes(sourceBytes);
    const sha256 = digest(bytes);
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
