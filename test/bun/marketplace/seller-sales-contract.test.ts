import { describe, expect, test } from "bun:test";

import {
  parseSellerEarningsResponse,
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
  nextCursor: null,
  protocolVersion: 1,
  rows: [{
    candidate,
    protocolVersion: 1,
    status: "completed",
    submissionId: `sub_${"0".repeat(26)}`,
  }],
};

const pricingSessionsResponse = {
  asOf: "2026-08-20T12:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    acceptedTokens: 1_000_000,
    accruedCents: 200,
    askCredits: 125,
    datasetId: "seller-dataset-alpha",
    earnedCredits: 100,
    listedAt: "2026-08-19T10:00:00Z",
    model: "claude-fable-5",
    modelTokenPricing: [{
      acceptedTokens: 1_000_000,
      accruedCents: 200,
      model: "claude-fable-5",
      rateCentsPerMillion: 200,
      status: "verified",
    }],
    rateCentsPerMillion: 200,
    saleStatus: {
      changedAt: "2026-08-20T11:30:00Z",
      exception: null,
      listingCycleId: "22222222-2222-4222-8222-222222222222",
      stage: "sold",
    },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: "2026-08-20T11:30:00Z",
  }],
};

describe("seller sales contracts", () => {
  test("Given seller candidate JSON, When its shape changes, Then the strict contract rejects it", () => {
    // Given
    const malformed = [
      { ...response, extra: true },
      { ...response, rows: [{ ...response.rows[0], extra: true }] },
      { ...response, rows: [{ ...response.rows[0], candidate: { ...candidate, extra: true } }] },
      { ...response, nextCursor: "invalid cursor" },
    ];

    // When / Then
    expect(parseSellerResponse("candidates", response) as unknown).toEqual(response);
    for (const value of malformed) {
      expect(() => parseSellerResponse("candidates", value)).toThrow(SellerSalesContractError);
    }
  });

  test("Given seller CLI options, When duplicates or malformed values arrive, Then parsing rejects them before transport", () => {
    // Given / When / Then
    const valid = parseSellerOptions("candidates", ["--cursor", "page-one", "--limit", "2"]);
    expect(String(valid?.cursor)).toBe("page-one");
    expect(valid?.limit).toBe(2);
    expect(parseSellerOptions("sales-sessions", ["--status", "paid", "--limit", "2"]) as unknown).toEqual({ limit: 2, status: "paid" });
    expect(parseSellerOptions("sales-earnings", [])).toEqual({});
    expect(parseSellerOptions("sales-earnings", ["--from", "2026-08-01", "--to", "2026-08-30", "--interval", "day"])).toEqual({
      from: "2026-08-01",
      interval: "day",
      to: "2026-08-30",
    });
    expect(parseSellerOptions("sales-ledger", ["--type", "refund"]) as unknown).toEqual({ type: "refund" });
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
    expect(parseSellerOptions("sales-earnings", ["--from", "2026-08-01"])).toBeUndefined();
    expect(parseSellerOptions("sales-earnings", ["--from", "2026-08-01", "--to", "2026-08-30"])).toBeUndefined();
    expect(parseSellerEarningsResponse({
      asOf: "2026-08-30T00:00:00Z",
      currency: "USD",
      interval: "day",
      ok: true,
      openingCumulativeCredits: 10,
      points: [{ cumulativeNetCredits: -5, periodStart: "2026-08-30T00:00:00Z" }],
      window: { from: "2026-08-01", to: "2026-08-30" },
    }).points[0]?.cumulativeNetCredits).toBe(-5);
  });

  test("parses model-token pricing observability on seller sessions", () => {
    expect(
      parseSellerResponse("sales-sessions", pricingSessionsResponse) as unknown,
    ).toEqual(pricingSessionsResponse);
    expect(() => parseSellerResponse("sales-sessions", {
      ...pricingSessionsResponse,
      sessions: [{ ...pricingSessionsResponse.sessions[0], acceptedTokens: undefined }],
    })).toThrow(SellerSalesContractError);
    expect(() => parseSellerResponse("sales-sessions", {
      ...pricingSessionsResponse,
      sessions: [{ ...pricingSessionsResponse.sessions[0], accruedCents: null }],
    })).toThrow(SellerSalesContractError);
    expect(() => parseSellerResponse("sales-sessions", {
      ...pricingSessionsResponse,
      sessions: [{
        ...pricingSessionsResponse.sessions[0],
        modelTokenPricing: [{
          ...pricingSessionsResponse.sessions[0].modelTokenPricing[0],
          status: undefined,
        }],
      }],
    })).toThrow(SellerSalesContractError);
    expect(() => parseSellerResponse("sales-sessions", {
      ...pricingSessionsResponse,
      sessions: [{ ...pricingSessionsResponse.sessions[0], unexpected: true }],
    })).toThrow(SellerSalesContractError);
  });
});
