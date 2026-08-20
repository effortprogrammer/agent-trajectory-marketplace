import { expect, test } from "bun:test"
// @ts-expect-error Browser JavaScript contract module is exercised directly by Bun.
import { parseEarningsResponse, parseLedgerResponse, parseSessionsResponse } from "../../../web/console-contract.js"

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
