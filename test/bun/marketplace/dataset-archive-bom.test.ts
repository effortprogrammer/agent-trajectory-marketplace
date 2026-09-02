import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  buildDatasetArchive,
  inspectTraceAdmission,
} from "../../../src/marketplace/dataset-archive";
import { MarketplaceError } from "../../../src/marketplace/error";
import { fullSelectorSchema, traceHashSchema } from "../../../src/marketplace/session-contract";
import type { FrozenTrace } from "../../../src/marketplace/session-contract";

const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

// Exact UTF-8 BOM byte sequence — never a "\uFEFF" string literal, so the
// construction under test is pinned to these bytes and nothing else.
const utf8BomPrefix = (): Uint8Array => Uint8Array.from([0xef, 0xbb, 0xbf]);

const prefixUtf8Bom = (bytes: Uint8Array): Uint8Array => {
  const bom = utf8BomPrefix();
  const prefixed = new Uint8Array(bom.byteLength + bytes.byteLength);
  prefixed.set(bom);
  prefixed.set(bytes, bom.byteLength);
  return prefixed;
};

// One source-attested event carrying positive supported compensated usage.
const supportedCompensatedAtf = (): Uint8Array => new TextEncoder().encode(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "message",
    name: "assistant",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: {
      usage: {
        model: "claude-fable-5",
        inputTokens: 2,
        outputTokens: 1,
      },
    },
  }],
}));

// Hash and byteCount attest the exact given source bytes, BOM included.
const frozenTrace = (selectorHex: string, bytes: Uint8Array): FrozenTrace =>
  Object.freeze({
    selector: fullSelectorSchema.parse(`s-${selectorHex.padStart(64, "0")}`),
    relativePath: `native/${selectorHex}.atf.json`,
    hash: traceHashSchema.parse(digest(bytes)),
    byteCount: bytes.byteLength,
    runtime: "codex",
    eventCount: 1,
    earliestTimestamp: "unknown",
    bytes,
  });

describe("dataset archive UTF-8 BOM construction admission", () => {
  test("admits the same source-attested compensated trace without a BOM", () => {
    // Given: the exact construction-side fixture with no BOM prefix.
    const trace = frozenTrace("c0", supportedCompensatedAtf());

    // When: the trace is inspected and assembled.
    const admission = inspectTraceAdmission(trace);
    const archive = buildDatasetArchive([trace]);

    // Then: the fixture is otherwise admissible, so only the BOM can flip later outcomes.
    expect(admission).toEqual({ status: "ready" });
    expect(archive.byteLength).toBeGreaterThan(0);
  });

  test("blocks a UTF-8 BOM-prefixed trace at admission inspection", () => {
    // Given: an otherwise valid source-attested compensated ATF trace whose
    // frozen bytes begin with the exact BOM sequence EF BB BF.
    const trace = frozenTrace("c1", prefixUtf8Bom(supportedCompensatedAtf()));

    // When: construction-side admission inspects the BOM-prefixed source bytes.
    const admission = inspectTraceAdmission(trace);

    // Then: the BOM is not silently stripped and re-parsed; sanitization fails closed.
    expect(admission).toEqual({ reason: "sanitization_failed", status: "blocked" });
  });

  test("rejects building a dataset archive from a UTF-8 BOM-prefixed trace", () => {
    // Given: an otherwise valid source-attested compensated ATF trace whose
    // frozen bytes begin with the exact BOM sequence EF BB BF.
    const trace = frozenTrace("c2", prefixUtf8Bom(supportedCompensatedAtf()));

    // When: the BOM-prefixed selection is assembled into a dataset archive.
    const build = (): Buffer => buildDatasetArchive([trace]);

    // Then: the archive is rejected locally instead of storing BOM-stripped, re-serialized bytes.
    expect(build).toThrow(new MarketplaceError("invalid_bundle_request"));
  });
});
