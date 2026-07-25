import { describe, expect, test } from "bun:test";

import {
  MarketplaceError,
  marketplaceErrorCodeSchema,
} from "../../../src/marketplace/error";
import {
  fullSelectorSchema,
  sessionSnapshotSchema,
  traceHashSchema,
  type FrozenTrace,
} from "../../../src/marketplace/session-contract";

const validHash = "a".repeat(64);
const validSelector = `s-${validHash}`;

describe("local session review contracts", () => {
  test("accepts a full selector and trace hash at the local boundary", () => {
    // Given: opaque, lowercase SHA-256 values produced for a frozen local trace.
    const selector = validSelector;
    const hash = validHash;

    // When: the CLI contract parses their untrusted string forms.
    const parsedSelector = fullSelectorSchema.parse(selector);
    const parsedHash = traceHashSchema.parse(hash);

    // Then: the exact values survive as branded local identities.
    expect(String(parsedSelector)).toBe(selector);
    expect(String(parsedHash)).toBe(hash);
  });

  test("rejects malformed selectors without accepting a prefix", () => {
    // Given: a short selector that could otherwise be ambiguous in an inventory.
    const selector = "s-abc123";

    // When: the local contract examines it at the command boundary.
    const result = fullSelectorSchema.safeParse(selector);

    // Then: it fails schema validation rather than resolving any trace.
    expect(result.success).toBe(false);
  });

  test("exposes only declared stable marketplace error codes", () => {
    // Given: a local bundle request whose required explicit input is invalid.
    const code = "invalid_bundle_request";

    // When: the stable error contract parses and carries the code.
    const parsed = marketplaceErrorCodeSchema.parse(code);
    const error = new MarketplaceError(parsed);

    // Then: callers receive the exact machine-readable failure code.
    expect(error.code).toBe("invalid_bundle_request");
    expect(marketplaceErrorCodeSchema.parse("unsupported_platform")).toBe("unsupported_platform");
    expect(marketplaceErrorCodeSchema.safeParse("unrecognized").success).toBe(false);
  });

  test("models a frozen snapshot with exact bytes and no transport metadata", () => {
    // Given: one validated ATF retained in a local review snapshot.
    const trace = {
      selector: fullSelectorSchema.parse(validSelector),
      relativePath: "traces/example.atf.json",
      hash: traceHashSchema.parse(validHash),
      byteCount: 2,
      runtime: "codex",
      eventCount: 0,
      earliestTimestamp: "unknown",
      bytes: new Uint8Array([123, 125]),
    } satisfies FrozenTrace;
    const snapshot = {
      root: "/absolute/collected-root",
      rootDevice: 42,
      rootInode: 84,
      traces: [trace],
      totalByteCount: trace.byteCount,
    };

    // When: the internal snapshot contract validates its externally assembled shape.
    const parsed = sessionSnapshotSchema.parse(snapshot);

    // Then: frozen identity, byte count, and byte payload remain available for review.
    expect(parsed.traces).toHaveLength(1);
    expect(String(parsed.traces[0]?.selector)).toBe(validSelector);
    expect(parsed.traces[0]?.earliestTimestamp).toBe("unknown");
    expect(parsed.totalByteCount).toBe(2);
  });
});
