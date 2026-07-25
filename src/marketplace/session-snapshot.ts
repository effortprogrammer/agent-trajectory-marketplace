import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import { harnessTraceDocumentSchema } from "../trajectory/adapters/contract";
import { discoverConfinedFiles, readConfinedFiles } from "./confined-reader";
import type { ConfinedFile, ConfinementOptions } from "./confined-reader";
import { MarketplaceError } from "./error";
import { fullSelectorSchema, traceHashSchema } from "./session-contract";
import type { FrozenTrace, FullSelector, SessionSnapshot } from "./session-contract";

const DEFAULT_MAX_RETAINED_BYTES = 512 * 1024 * 1024;

export type SnapshotReadOptions = ConfinementOptions & Readonly<{
  readonly maxRetainedBytes?: number;
}>;

type TraceMetadata = Readonly<{
  readonly runtime: string;
  readonly eventCount: number;
  readonly earliestTimestamp: string | "unknown";
}>;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalRoot(root: string): string {
  if (!isAbsolute(root)) throw new MarketplaceError("invalid_root");
  try {
    return realpathSync(root);
  } catch (error) {
    if (error instanceof MarketplaceError) throw error;
    throw new MarketplaceError("invalid_root");
  }
}

function safeExplicitPath(value: string): string {
  const parts = value.split(/[\\/]/u);
  if (value.length === 0 || isAbsolute(value) || parts.includes("..") || !value.endsWith(".atf.json")) {
    throw new MarketplaceError("unsafe_trace_path");
  }
  return parts.filter((part) => part !== "" && part !== ".").join("/");
}

function validateBytes(bytes: Uint8Array): TraceMetadata {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw new MarketplaceError("invalid_trace");
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new MarketplaceError("invalid_trace");
    throw error;
  }
  const parsed = harnessTraceDocumentSchema.safeParse(value);
  if (!parsed.success) throw new MarketplaceError("invalid_trace");
  let earliestTimestamp: string | "unknown" = "unknown";
  let earliestTime = Number.POSITIVE_INFINITY;
  for (const event of parsed.data.events) {
    if (event.timestamp === undefined) continue;
    const time = Date.parse(event.timestamp);
    if (time < earliestTime) {
      earliestTimestamp = event.timestamp;
      earliestTime = time;
    }
  }
  return { runtime: parsed.data.runtime, eventCount: parsed.data.eventCount, earliestTimestamp };
}

function freezeTrace(relativePath: string, bytes: Uint8Array, metadata: TraceMetadata): FrozenTrace {
  const retained = new Uint8Array(bytes);
  const hash = traceHashSchema.parse(digest(retained));
  const selector = fullSelectorSchema.parse(`s-${digest(new TextEncoder().encode(relativePath))}`);
  return Object.freeze({
    selector,
    relativePath,
    hash,
    byteCount: retained.byteLength,
    ...metadata,
    get bytes(): Uint8Array {
      return new Uint8Array(retained);
    },
  });
}

function buildSnapshot(root: string, files: readonly ConfinedFile[]): SessionSnapshot {
  const traces: FrozenTrace[] = [];
  let totalByteCount = 0;
  for (const { relativePath, bytes } of files) {
    const trace = freezeTrace(relativePath, bytes, validateBytes(bytes));
    traces.push(trace);
    totalByteCount += trace.byteCount;
  }
  traces.sort((left, right) => left.selector.localeCompare(right.selector));
  return Object.freeze({ root, traces: Object.freeze(traces), totalByteCount });
}

export function scanSessionSnapshot(root: string,
  options: SnapshotReadOptions = {}): SessionSnapshot {
  const canonical = canonicalRoot(root);
  const maxBytes = retainedLimit(options);
  return buildSnapshot(canonical, discoverConfinedFiles({ root: canonical, maxBytes, options }));
}

export function readExplicitTraces(root: string, paths: readonly string[],
  options: SnapshotReadOptions = {}): SessionSnapshot {
  const canonical = canonicalRoot(root);
  const normalized = paths.map(safeExplicitPath);
  if (new Set(normalized).size !== normalized.length) {
    throw new MarketplaceError("duplicate_trace");
  }
  const maxBytes = retainedLimit(options);
  const files = readConfinedFiles({
    root: canonical, maxBytes, options, relativePaths: normalized,
    errorCode: options.afterInitialStat === undefined ? "unsafe_trace_path" : "trace_drift",
  });
  return buildSnapshot(canonical, files);
}

function retainedLimit(options: SnapshotReadOptions): number {
  const maxBytes = options.maxRetainedBytes ?? DEFAULT_MAX_RETAINED_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new MarketplaceError("snapshot_too_large");
  }
  return maxBytes;
}

export function resolveTraceSelector(snapshot: SessionSnapshot, selector: string): FrozenTrace {
  const parsed = fullSelectorSchema.safeParse(selector);
  if (!parsed.success) throw new MarketplaceError("invalid_selector");
  const trace = snapshot.traces.find((candidate) => candidate.selector === parsed.data);
  if (trace === undefined) throw new MarketplaceError("missing_selector");
  return trace;
}

export function assertTracesUnchanged(snapshot: SessionSnapshot,
  selected: readonly FrozenTrace[]): readonly FrozenTrace[] {
  const seen = new Set<FullSelector>();
  return selected.map((trace) => {
    if (seen.has(trace.selector)) throw new MarketplaceError("duplicate_trace");
    seen.add(trace.selector);
    const original = resolveTraceSelector(snapshot, trace.selector);
    if (
      original.relativePath !== trace.relativePath ||
      original.hash !== trace.hash ||
      original.byteCount !== trace.byteCount ||
      original.runtime !== trace.runtime ||
      original.eventCount !== trace.eventCount ||
      original.earliestTimestamp !== trace.earliestTimestamp
    ) {
      throw new MarketplaceError("trace_drift");
    }
    const frozenBytes = original.bytes;
    if (frozenBytes.byteLength !== original.byteCount || digest(frozenBytes) !== original.hash) {
      throw new MarketplaceError("trace_drift");
    }
    const current = readConfinedFiles({
      root: snapshot.root,
      relativePaths: [original.relativePath],
      maxBytes: original.byteCount,
      errorCode: "trace_drift",
      options: {},
    })[0]?.bytes;
    if (current === undefined || current.byteLength !== original.byteCount || digest(current) !== original.hash) {
      throw new MarketplaceError("trace_drift");
    }
    return freezeTrace(original.relativePath, frozenBytes, {
      runtime: original.runtime,
      eventCount: original.eventCount,
      earliestTimestamp: original.earliestTimestamp,
    });
  });
}
