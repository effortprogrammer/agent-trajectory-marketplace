import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"

import {
  payoutRequestDetailSchema,
  payoutRequestEnvelopeSchema,
  payoutRequestStatuses,
  parsePayoutRequestResponse,
} from "../../../src/marketplace/payout-request-contract"
// @ts-expect-error Browser JavaScript contract module is exercised directly by Bun.
import * as consoleContract from "../../../web/console-contract.js"

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex")
const fixture = async (root: string, name: string): Promise<Buffer> =>
  readFile(join(import.meta.dir, "../../../contract", root, name))

const payoutRoot = "payout-request/v1"
const walletRoot = "wallet-balance/v1"
const worldRoot = "world/v1"

// Released baseline digests (commit 0607d40 tree dd9f747). Machine values only.
// Pure data tables: the pinned sha256 maps ARE the released artifact under test.
const payoutRequestDigests: Readonly<Record<string, string>> = {
  "manifest.json":
    "5228772256c652181a5ced835d2782b25caf46aa038cfba4bafa149cc9295d06",
  "get-empty-200.json":
    "480a680264f127870e74919ca647ec6f545e540c6789ea7c14fb2bb9e49c387e",
  "requested-201.json":
    "3cc560d8eb6f1b2200b5f0926d932a928cfa9cc01839dd82767d6bfc360c0bf3",
  "requested-replay-200.json":
    "3cc560d8eb6f1b2200b5f0926d932a928cfa9cc01839dd82767d6bfc360c0bf3",
  "pending-200.json":
    "c772e87d918094610eaa4bed8b8a9d870ae6fd02089a0d3a20cdf00436ddb7a7",
  "approved-200.json":
    "6b8ddeee40909dee45e85142ec9aedbc8d7d99e47f6577787cbc71089aab5b38",
  "processing-200.json":
    "db14033d74e2fb5a8b893dd53391a0e153d0f47ac67a6c712baf81332d4bb7e0",
  "cancelled-200.json":
    "00cedb693195ff66fa741358b059dcaf2839307805ccf47833a35dccd33eee82",
  "rejected-200.json":
    "856c0c293afa225c0257bb7455c5ac11208672e2ebb63bbf73e69032c91eb0e2",
  "paid-200.json":
    "4e9bfbc01865126eaef954e5fd98af0f108957da48a3cbe3f7dc91c87ac18a54",
  "withdrawn-200.json":
    "f12aab19edeac150cd38fc542ea7202b13c573df464c2fc821daa9b34bdea1e2",
  "error-400-invalid-request.json":
    "5e2019d45fd1df53ed46bd2e047b56af43eaed77b7a405c88ba94a7a7d8d8be2",
  "error-401-unauthorized.json":
    "4f8989d23b2185a16438d91e02d420a8b348385c3d6d8e09b0f7c8f25c5424b0",
  "error-403-forbidden.json":
    "2131f27caab8b3e2042e0a79fe4fbb45074bdc0ee3fd2e3d12efcd78ab2f998f",
  "error-409-open-request.json":
    "7da4428e2c8da09bb9a376055c504f4a5c0110e101f2e155b91b74dd1f1f205c",
  "error-409-not-withdrawable.json":
    "3ea840650fda6a3ce5cdd8252c188186baeaca495d2d48a7344bb54f4e93c51f",
  "error-409-conflict.json":
    "82cabbfba8500b4ec0c06d188437ed78aa06cfd84ae5226b9030da739d68b770",
  "error-422-below-threshold.json":
    "38bdba62db42091d8737f1d1e68b384b0a58118df8d4fc22dacbbb845dc92a41",
  "error-429-rate-limited.json":
    "eb472dc597279c9dd1b11b11e65dba505054485e7120baf2efb8af7b9a6b5591",
  "error-503-creation-disabled.json":
    "225e7f9ce7a1ec97625183fe5a929920f4926459e0d3f064fd595f8588843eea",
  "error-503-service-unavailable.json":
    "f5aa17fba0cbbff1f2a4dc3a5e17faf76a73f251bd3b4981d8de6365edaba355",
}

const walletBalanceDigests: Readonly<Record<string, string>> = {
  "manifest.json":
    "efd47886edd1ea5e39dd8ebf0b9e842a45c981b533864d070f7d1ce5242f18c6",
  "balance-200.json":
    "8e88deb2a6005c36f9d4d3db8e484c481a30a2a9c0a8158ee2a50f5d4891f404",
  "error-401.json":
    "4f8989d23b2185a16438d91e02d420a8b348385c3d6d8e09b0f7c8f25c5424b0",
  "error-403.json":
    "448a404a1b0fbf3e0e43402edb5b25aa5d50a2e49e1eb7240150b2ccfd3a5cef",
}

const worldFixtureDigests: Readonly<Record<string, string>> = {
  "manifest.json":
    "01f0b6ef88d35a35f799aa10c51337c2a863da1fb8998afe671d6d29f33902b7",
  "catalog-list-200.json":
    "a5f024b2b8cff591c3cd94a5523c2a4905b0440ae776f7dc81c0f1942fca6aab",
  "catalog-detail-200.json":
    "f1982f76dc61564e5d9963b558fd2a0d561e9161d912e8790d0829c985ee2740",
  "catalog-error-404.json":
    "fef916c279def93f790d739d8525fc7ffd697a4a492029472c5752bda04a4faf",
  "entitlement-hosted-200.json":
    "f34b08b841dc59d5dd2742ebe9608eecbfd720db6723f0dae5174611f0960fb0",
  "entitlement-download-200.json":
    "67bed3c6ba288e11d3399920c049766936f3d0331ccd7f56693ce0e114c86b81",
  "hosted-create-200.json":
    "c6765ee57e71e24ceb243e554f9115012d3e07c226b1310d5ddeccc260fce654",
  "hosted-status-200.json":
    "c6765ee57e71e24ceb243e554f9115012d3e07c226b1310d5ddeccc260fce654",
  "hosted-error-409.json":
    "3911acb48e68bbecf99d9840fe75558c409af5b5b161284234db9f477c9e4117",
}

const frozenWorldRoutes: readonly string[] = [
  "GET /v1/marketplace/worlds",
  "GET /v1/marketplace/worlds/{world_id:path}",
  "POST /v1/marketplace/buyer/world-entitlements",
  "POST /v1/marketplace/buyer/world-entitlements/{entitlement_id}/downloads",
  "POST /v1/marketplace/buyer/world-contracts/{contract_id}/hosted/instances",
  "GET /v1/marketplace/buyer/world-contracts/{contract_id}/hosted/instances/{instance_id}",
]

const releasedStatuses: readonly (typeof payoutRequestStatuses)[number][] = [
  "requested",
  "pending",
  "approved",
  "processing",
  "cancelled",
  "rejected",
  "paid",
]

const statusFixtures: ReadonlyArray<readonly [string, number]> = [
  ["requested-201.json", 201],
  ["requested-replay-200.json", 200],
  ["pending-200.json", 200],
  ["approved-200.json", 200],
  ["processing-200.json", 200],
  ["cancelled-200.json", 200],
  ["rejected-200.json", 200],
  ["paid-200.json", 200],
  ["withdrawn-200.json", 200],
]

const sessionPricingPayload = (status: string): unknown => ({
  asOf: "2026-08-20T12:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [
    {
      acceptedTokens: 1_000_000,
      accruedCents: 200,
      askCredits: 125,
      datasetId: "seller-dataset-baseline",
      earnedCredits: 200,
      listedAt: "2026-08-19T10:00:00Z",
      model: "claude-fable-5",
      modelTokenPricing: [
        {
          acceptedTokens: 1_000_000,
          accruedCents: 200,
          model: "claude-fable-5",
          rateCentsPerMillion: 200,
          status,
        },
      ],
      rateCentsPerMillion: 200,
      saleStatus: {
        changedAt: "2026-08-20T11:30:00Z",
        exception: null,
        listingCycleId: "22222222-2222-4222-8222-222222222222",
        stage: "sold",
      },
      sessionId: "11111111-1111-4111-8111-111111111111",
      soldAt: "2026-08-20T11:30:00Z",
    },
  ],
})

const manifestDigests = async (
  root: string,
): Promise<ReadonlyArray<readonly [string, string]>> => {
  const manifest = JSON.parse(
    (await fixture(root, "manifest.json")).toString("utf8"),
  ) as { fixtures: ReadonlyArray<{ file: string; sha256: string }> }
  return manifest.fixtures.map((entry) => [entry.file, entry.sha256] as const)
}

describe("released credit economy baseline (plan Todo 5)", () => {
  it("pins every payout request v1 fixture byte to its released digest", async () => {
    const manifestEntries = await manifestDigests(payoutRoot)

    expect(manifestEntries.map(([file]) => file).sort()).toEqual(
      Object.keys(payoutRequestDigests).filter((name) => name !== "manifest.json").sort(),
    )
    for (const [name, expected] of Object.entries(payoutRequestDigests)) {
      expect(sha256(await fixture(payoutRoot, name))).toBe(expected)
    }
    for (const [file, declared] of manifestEntries) {
      expect(sha256(await fixture(payoutRoot, file))).toBe(declared)
    }
  })

  it("pins every wallet balance v1 fixture byte to its released digest", async () => {
    const manifestEntries = await manifestDigests(walletRoot)

    expect(manifestEntries.map(([file]) => file).sort()).toEqual(
      Object.keys(walletBalanceDigests).filter((name) => name !== "manifest.json").sort(),
    )
    for (const [name, expected] of Object.entries(walletBalanceDigests)) {
      expect(sha256(await fixture(walletRoot, name))).toBe(expected)
    }
    for (const [file, declared] of manifestEntries) {
      expect(sha256(await fixture(walletRoot, file))).toBe(declared)
    }
  })

  it("pins the excluded World v1 contract routes and fixture bytes", async () => {
    const manifest = JSON.parse(
      (await fixture(worldRoot, "manifest.json")).toString("utf8"),
    ) as { routes: string[]; fixtures: string[] }

    expect([...manifest.routes]).toEqual([...frozenWorldRoutes])
    expect([...manifest.fixtures].sort()).toEqual(
      Object.keys(worldFixtureDigests).filter((name) => name !== "manifest.json").sort(),
    )
    for (const [name, expected] of Object.entries(worldFixtureDigests)) {
      expect(sha256(await fixture(worldRoot, name))).toBe(expected)
    }
  })

  it("pins the v1 payout wire threshold at exactly 10000 minor units", async () => {
    const requested = await fixture(payoutRoot, "requested-201.json")
    const parsed = parsePayoutRequestResponse(201, requested)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("unreachable")
    expect(parsed.payoutRequest.thresholdMinor).toBe(10_000)
    expect(parsed.payoutRequest.currency).toBe("USD")
    const lifted = JSON.parse(requested.toString("utf8")) as Record<string, unknown>
    expect(() =>
      payoutRequestEnvelopeSchema.parse({
        ...lifted,
        payoutRequest: {
          ...(lifted.payoutRequest as object),
          thresholdMinor: 10_001,
        },
      }),
    ).toThrow()
  })

  it("pins the released manual payout status set and its nullability rules", async () => {
    expect([...payoutRequestStatuses]).toEqual([...releasedStatuses])
    for (const [file, status] of statusFixtures) {
      const parsed = parsePayoutRequestResponse(status, await fixture(payoutRoot, file))
      expect(parsed.ok).toBe(true)
    }
    const paid = JSON.parse(
      (await fixture(payoutRoot, "paid-200.json")).toString("utf8"),
    ) as { payoutRequest: { request: Record<string, unknown> } }
    expect(paid.payoutRequest.request.status).toBe("paid")
    expect(paid.payoutRequest.request.externalReference).not.toBeNull()
    expect(() =>
      payoutRequestDetailSchema.parse({
        ...paid.payoutRequest.request,
        status: "processing",
        approvedAt: null,
      }),
    ).toThrow()
    expect(() =>
      payoutRequestDetailSchema.parse({
        ...paid.payoutRequest.request,
        status: "rejected",
        rejectedReason: null,
      }),
    ).toThrow()
  })

  it("pins the seller console pricing status vocabulary to pending or verified", () => {
    const { parseSessionsResponse, SellerSalesContractError } = consoleContract as {
      parseSessionsResponse: (value: unknown) => unknown
      SellerSalesContractError: new () => Error
    }

    expect(parseSessionsResponse(sessionPricingPayload("verified"))).toBeTruthy()
    expect(parseSessionsResponse(sessionPricingPayload("pending"))).toBeTruthy()
    for (const unknownStatus of ["swept", "accrued", ""]) {
      expect(() => parseSessionsResponse(sessionPricingPayload(unknownStatus))).toThrow(
        SellerSalesContractError,
      )
    }
  })
})
