import { describe, expect, test } from "bun:test";

import {
  parseSellerOptions,
  parseSellerResponse,
  SellerSalesContractError,
} from "../../../src/marketplace/seller-sales-contract";

const candidate = {
  archiveByteCount: 1,
  archiveSha256: "a".repeat(64),
  artifactCount: 1,
  bundleId: `bundle-${"b".repeat(64)}`,
  manifestSha256: "c".repeat(64),
  protocolVersion: 1,
};

const response = {
  candidates: [candidate],
  ok: true,
  page: { nextCursor: null },
};

describe("seller sales contracts", () => {
  test("Given seller candidate JSON, When its shape changes, Then the strict contract rejects it", () => {
    // Given
    const malformed = [
      { ...response, extra: true },
      { ...response, page: { nextCursor: null, extra: true } },
      { ...response, candidates: [{ ...candidate, extra: true }] },
      { ...response, page: { nextCursor: "invalid cursor" } },
    ];

    // When / Then
    for (const value of malformed) {
      expect(() => parseSellerResponse("candidates", value)).toThrow(SellerSalesContractError);
    }
  });

  test("Given seller CLI options, When duplicates or malformed values arrive, Then parsing rejects them before transport", () => {
    // Given / When / Then
    const valid = parseSellerOptions("candidates", ["--cursor", "page-one", "--limit", "2"]);
    expect(String(valid?.cursor)).toBe("page-one");
    expect(valid?.limit).toBe(2);
    for (const argumentsList of [
      ["--cursor", "page one"],
      ["--limit", "0"],
      ["--limit", "101"],
      ["--cursor", "one", "--cursor", "two"],
      ["--from", "2026-08-30", "--to", "2026-08-01"],
      ["--interval", "year"],
    ]) {
      expect(parseSellerOptions("sales-sessions", argumentsList)).toBeUndefined();
    }
  });
});
