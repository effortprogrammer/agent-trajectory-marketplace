import { expect, test } from "bun:test"
// @ts-expect-error Browser JavaScript contract module is exercised directly by Bun.
import * as consoleContract from "../../../web/console-contract.js"

const {
  parseEarningsResponse,
  parseLedgerResponse,
  parseSessionsResponse,
} = consoleContract

const sessions = {
  asOf: "2026-08-20T12:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    askCredits: 125,
    datasetId: "seller-dataset-alpha",
    earnedCredits: 100,
    listedAt: "2026-08-19T10:00:00Z",
    saleStatus: {
      changedAt: "2026-08-20T11:30:00Z",
      exception: null,
      listingCycleId: "22222222-2222-4222-8222-222222222222",
      stage: "sold",
    },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: "2026-08-20T11:30:00Z",
  }],
}

const earnings = {
  asOf: "2026-08-20T12:00:00Z",
  currency: "USD",
  interval: "week",
  ok: true,
  openingCumulativeCredits: 500,
  points: [
    { cumulativeNetCredits: 475, periodStart: "2026-08-03T00:00:00Z" },
    { cumulativeNetCredits: 650, periodStart: "2026-08-10T00:00:00Z" },
  ],
  window: { from: "2026-08-01", to: "2026-08-20" },
}

const ledger = {
  asOf: "2026-08-20T12:00:00Z",
  events: [{
    amountCredits: 100,
    eventId: "33333333-3333-4333-8333-333333333333",
    occurredAt: "2026-08-20T11:30:00Z",
    relatedSessionCount: null,
    sessionId: "11111111-1111-4111-8111-111111111111",
    type: "sale",
  }],
  ok: true,
  page: { nextCursor: "ledger-next" },
}

const payoutRequest = {
  amountMinor: 15_000,
  approvedAt: null,
  externalReference: null,
  paidAt: null,
  rejectedReason: null,
  requestId: "44444444-4444-4444-8444-444444444444",
  requestedAt: "2026-08-29T00:00:00Z",
  status: "requested",
}

const payoutResponse = (request: unknown, availableMinor = 0, heldMinor = 15_000) => ({
  ok: true,
  payoutRequest: {
    availableMinor,
    currency: "USD",
    heldMinor,
    request,
    thresholdMinor: 10_000,
  },
})

test("payout contract accepts every frozen state and formats USD minor units", () => {
  const parse = Reflect.get(consoleContract, "parsePayoutResponse")
  const format = Reflect.get(consoleContract, "formatPayoutAmount")
  expect(typeof parse).toBe("function")
  expect(typeof format).toBe("function")
  if (typeof parse !== "function" || typeof format !== "function") return

  const approvedAt = "2026-08-29T01:00:00Z"
  const paidAt = "2026-08-29T02:00:00Z"
  const responses = [
    payoutResponse(null, 9_999, 0),
    payoutResponse({ ...payoutRequest, status: "requested" }),
    payoutResponse({ ...payoutRequest, status: "pending" }),
    payoutResponse({ ...payoutRequest, approvedAt, status: "approved" }),
    payoutResponse({ ...payoutRequest, approvedAt, status: "processing" }),
    payoutResponse({ ...payoutRequest, status: "cancelled" }, 15_000, 0),
    payoutResponse({ ...payoutRequest, rejectedReason: "Destination needs review.", status: "rejected" }, 15_000, 0),
    payoutResponse({ ...payoutRequest, approvedAt, externalReference: "manual-ach-42", paidAt, status: "paid" }, 0, 0),
  ]
  for (const response of responses) expect(parse(response)).toEqual(response)
  expect(format(10_000)).toBe("$100.00")
  expect(format(15_000)).toBe("$150.00")
})

test("payout contract rejects unknown fields and invalid state nullability", () => {
  const parse = Reflect.get(consoleContract, "parsePayoutResponse")
  expect(typeof parse).toBe("function")
  if (typeof parse !== "function") return
  expect(() => parse({ ...payoutResponse(null), unexpected: true })).toThrow()
  expect(() => parse(payoutResponse({ ...payoutRequest, approvedAt: null, status: "approved" }))).toThrow()
  expect(() => parse(payoutResponse({ ...payoutRequest, rejectedReason: null, status: "rejected" }))).toThrow()
  expect(() => parse(payoutResponse({ ...payoutRequest, externalReference: null, paidAt: null, status: "paid" }))).toThrow()
})

test("seller sales contract validators strictly accept golden response shapes", () => {
  expect(parseSessionsResponse(sessions)).toEqual(sessions)
  expect(parseEarningsResponse(earnings)).toEqual(earnings)
  expect(parseLedgerResponse(ledger)).toEqual(ledger)
})

test("seller sales contract validators reject unknown fields, snake case, and wrong types", () => {
  expect(() => parseSessionsResponse({ ...sessions, unexpected: true })).toThrow()
  expect(() => parseSessionsResponse({ ...sessions, sessions: [{ ...sessions.sessions[0], dataset_id: "nope" }] })).toThrow()
  expect(() => parseEarningsResponse({ ...earnings, openingCumulativeCredits: "500" })).toThrow()
  expect(() => parseLedgerResponse({ ...ledger, events: [{ ...ledger.events[0], amountCredits: -1 }] })).toThrow()
})

test("seller sales contract validators reject non-canonical timestamps", () => {
  expect(() => parseSessionsResponse({ ...sessions, asOf: "Aug 20 2026" })).toThrow()
  expect(() => parseSessionsResponse({ ...sessions, asOf: "2026-08-20T12:00:00+09:00" })).toThrow()
  expect(() => parseEarningsResponse({ ...earnings, points: [{ ...earnings.points[0], periodStart: "2026-08-20" }] })).toThrow()
  for (const asOf of ["2026-02-30T12:00:00Z", "2026-04-31T12:00:00Z", "2026-01-01T24:00:00Z", "2026-02-29T12:00:00Z"]) {
    expect(() => parseSessionsResponse({ ...sessions, asOf })).toThrow()
  }
  expect(() => parseEarningsResponse({ ...earnings, window: { ...earnings.window, from: "2026-02-30" } })).toThrow()
})
