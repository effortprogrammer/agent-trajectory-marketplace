import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { encodeDatasetManifest } from "../../../src/marketplace/archive-contract";
import { buildDatasetArchive } from "../../../src/marketplace/dataset-archive";
import { MarketplaceError } from "../../../src/marketplace/error";
import { PublishBundleError, parsePublishBundle } from "../../../src/marketplace/publish-bundle";
import { fullSelectorSchema, traceHashSchema } from "../../../src/marketplace/session-contract";
import type { FrozenTrace } from "../../../src/marketplace/session-contract";
import { writeDatasetZip } from "../../../src/marketplace/stored-zip";

// The aggregate cap every pre-publication surface must enforce: the sum of
// input plus output tokens over all source-attested supported-model usage in
// one archive may reach 100,000,000 but not exceed it.
const aggregateTokenCap = 100_000_000;

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

type TokenPair = Readonly<{
  readonly inputTokens: number;
  readonly outputTokens: number;
}>;

// One usage event declaring large numeric counts: no token-sized payloads exist.
const traceBuffer = (pair: TokenPair): Buffer => Buffer.from(JSON.stringify({
  runtime: "codex",
  status: "collected",
  formatVersion: 2,
  eventCount: 1,
  events: [{
    kind: "message",
    name: "assistant",
    timestamp: "2026-09-01T00:00:00.000Z",
    sourceEventId: "usage-0",
    payload: { usage: { model: "claude-fable-5", inputTokens: pair.inputTokens, outputTokens: pair.outputTokens } },
  }],
}), "utf8");

const frozenTrace = (selectorHex: string, pair: TokenPair): FrozenTrace => {
  const bytes = traceBuffer(pair);
  return Object.freeze({
    selector: fullSelectorSchema.parse(`s-${selectorHex.padStart(64, "0")}`),
    relativePath: `native/${selectorHex}.atf.json`,
    hash: traceHashSchema.parse(digest(bytes)),
    byteCount: bytes.byteLength,
    runtime: "codex",
    eventCount: 1,
    earliestTimestamp: "2026-09-01T00:00:00.000Z",
    get bytes(): Uint8Array {
      return new Uint8Array(bytes);
    },
  });
};

// Hand-built manifest-consistent stored bundle, bypassing the construction gate.
const storedBundle = (pairs: readonly TokenPair[]): Buffer => {
  const traces = pairs.map(traceBuffer);
  const artifacts = traces.map((bytes, index) => {
    const label = `s-${index.toString(16).padStart(64, "0")}`;
    return {
      byteCount: bytes.byteLength,
      label,
      path: `traces/${label}.atf.json`,
      sha256: digest(bytes),
    };
  });
  return writeDatasetZip([
    { data: encodeDatasetManifest({ artifacts, formatVersion: 1 }), name: "dataset-manifest.json" },
    ...artifacts.map((artifact, index) => ({ data: traces[index], name: artifact.path })),
  ]);
};

const constructionOutcome = (membership: readonly FrozenTrace[]): string => {
  try {
    buildDatasetArchive(membership);
  } catch (error) {
    if (error instanceof MarketplaceError) return error.code;
    throw error;
  }
  return "admitted";
};

const admissionOutcome = (archive: Buffer): string => {
  try {
    parsePublishBundle(archive);
  } catch (error) {
    if (error instanceof PublishBundleError) return error.code;
    throw error;
  }
  return "admitted";
};

// Splits chosen so both token directions count toward the aggregate: input-heavy
// and output-heavy halves each carry 50,000,000 supported tokens.
const inputHeavy: TokenPair = { inputTokens: 30_000_000, outputTokens: 20_000_000 };
const outputHeavyExact: TokenPair = { inputTokens: 20_000_000, outputTokens: 30_000_000 };
const outputHeavyOneOver: TokenPair = { inputTokens: 20_000_000, outputTokens: 30_000_001 };

describe("aggregate supported token cap", () => {
  test("admits new archive construction at exactly 100,000,000 aggregate supported tokens", () => {
    // Given: a membership whose source-attested supported usage totals exactly the cap.
    const membership = [frozenTrace("1", inputHeavy), frozenTrace("2", outputHeavyExact)];
    const expected = inputHeavy.inputTokens + inputHeavy.outputTokens
      + outputHeavyExact.inputTokens + outputHeavyExact.outputTokens;

    // When: the exact-cap membership is assembled into a dataset archive.
    const archive = buildDatasetArchive(membership);

    // Then: the cap admits the boundary value because only totals above it are rejected.
    expect(expected).toBe(aggregateTokenCap);
    expect(archive.byteLength).toBeGreaterThan(0);
  });

  test("rejects new archive construction at 100,000,001 aggregate supported tokens", () => {
    // Given: a membership whose aggregate supported usage exceeds the cap by exactly one token.
    const membership = [frozenTrace("3", inputHeavy), frozenTrace("4", outputHeavyOneOver)];

    // When: the over-cap membership is assembled.
    const outcome = constructionOutcome(membership);

    // Then: construction fails closed with the stable bundle admission error.
    expect(outcome).toBe("unsupported_model");
  });

  test("admits a stored bundle at exactly 100,000,000 aggregate supported tokens", () => {
    // Given: a hand-built manifest-consistent stored bundle at the exact cap.
    const archive = storedBundle([inputHeavy, outputHeavyExact]);

    // When: the stored bundle crosses normal publication admission.
    const bundle = parsePublishBundle(archive);

    // Then: both artifacts are admitted because the boundary value is not over the cap.
    expect(bundle.artifacts).toHaveLength(2);
  });

  test("rejects a stored bundle at 100,000,001 aggregate supported tokens", () => {
    // Given: a hand-built manifest-consistent stored bundle one token over the cap,
    // reachable without passing through archive construction.
    const archive = storedBundle([inputHeavy, outputHeavyOneOver]);

    // When: the stored bundle crosses normal publication admission.
    const outcome = admissionOutcome(archive);

    // Then: re-admission fails closed with the stable bundle admission error.
    expect(outcome).toBe("unsupported_model");
  });
});
