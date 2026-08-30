import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  PayoutRequestContractError,
  encodePayoutRequestResponse,
  parsePayoutRequestResponse,
  payoutRequestDetailSchema,
  payoutRequestEnvelopeSchema,
  payoutRequestErrorSchema,
} from "../../../src/marketplace/payout-request-contract"

const fixtureRoot = join(import.meta.dir, "../../../contract/payout-request/v1")
const fixture = async (name: string): Promise<Buffer> => readFile(join(fixtureRoot, name))

const successFixtures = [
  ["get-empty-200.json", 200],
  ["requested-201.json", 201],
  ["requested-replay-200.json", 200],
  ["pending-200.json", 200],
  ["approved-200.json", 200],
  ["processing-200.json", 200],
  ["cancelled-200.json", 200],
  ["rejected-200.json", 200],
  ["paid-200.json", 200],
  ["withdrawn-200.json", 200],
] as const

const errorFixtures = [
  ["error-400-invalid-request.json", 400],
  ["error-401-unauthorized.json", 401],
  ["error-403-forbidden.json", 403],
  ["error-409-open-request.json", 409],
  ["error-409-not-withdrawable.json", 409],
  ["error-409-conflict.json", 409],
  ["error-422-below-threshold.json", 422],
  ["error-429-rate-limited.json", 429],
  ["error-503-creation-disabled.json", 503],
  ["error-503-service-unavailable.json", 503],
] as const

describe("payout request v1 contract", () => {
  it("accepts every frozen success fixture byte-for-byte at its frozen status", async () => {
    for (const [file, status] of successFixtures) {
      const bytes = await fixture(file)
      const parsed = parsePayoutRequestResponse(status, bytes)
      expect(parsed).toEqual(payoutRequestEnvelopeSchema.parse(JSON.parse(bytes.toString("utf8"))))
      expect(encodePayoutRequestResponse(parsed)).toEqual(bytes)
    }
  })

  it("accepts every frozen error fixture byte-for-byte at its frozen status", async () => {
    for (const [file, status] of errorFixtures) {
      const bytes = await fixture(file)
      const parsed = parsePayoutRequestResponse(status, bytes)
      expect(parsed).toEqual(payoutRequestErrorSchema.parse(JSON.parse(bytes.toString("utf8"))))
      expect(encodePayoutRequestResponse(parsed)).toEqual(bytes)
    }
  })

  it("rejects unknown, unsafe, and non-canonical values", async () => {
    const empty = payoutRequestEnvelopeSchema.parse(JSON.parse((await fixture("get-empty-200.json")).toString("utf8")))
    const requested = JSON.parse((await fixture("requested-201.json")).toString("utf8"))
    const envelope = (request: unknown): unknown => ({
      ...empty,
      payoutRequest: { ...empty.payoutRequest, request },
    })
    const detail = requested.payoutRequest.request
    const invalid = [
      { ...empty, extra: true },
      envelope({ ...detail, amountMinor: 1.5 }),
      envelope({ ...detail, amountMinor: -1 }),
      envelope({ ...detail, amountMinor: Number.MAX_SAFE_INTEGER + 1 }),
      envelope({ ...detail, requestId: "00000000-0000-4000-8000-00000000010g" }),
      envelope({ ...detail, status: "swept" }),
      envelope({ ...detail, requestedAt: "2026-08-29 00:00:00Z" }),
      envelope({ ...detail, approvedAt: "2026-08-30T00:00:00Z" }),
      envelope({ ...detail, externalReference: "ACH-1" }),
      { ...empty, payoutRequest: { ...empty.payoutRequest, currency: "EUR" } },
      { ...empty, payoutRequest: { ...empty.payoutRequest, thresholdMinor: 5000 } },
      { ...empty, payoutRequest: { ...empty.payoutRequest, heldMinor: -1 } },
    ]

    for (const input of invalid) {
      expect(() => payoutRequestEnvelopeSchema.parse(input)).toThrow()
    }
    expect(() => payoutRequestDetailSchema.parse({
      ...detail,
      status: "rejected",
      rejectedReason: null,
    })).toThrow()
    const paid = JSON.parse((await fixture("paid-200.json")).toString("utf8"))
    expect(() => payoutRequestDetailSchema.parse({
      ...paid.payoutRequest.request,
      externalReference: null,
    })).toThrow()
  })

  it("maps only the frozen success and error statuses", async () => {
    const forbidden = await fixture("error-403-forbidden.json")
    const serviceUnavailable = await fixture("error-503-service-unavailable.json")
    const requested = await fixture("requested-201.json")

    expect(() => parsePayoutRequestResponse(200, Buffer.from("{}"))).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(202, requested)).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(404, forbidden)).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(401, forbidden)).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(500, serviceUnavailable)).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(403, Buffer.from(
      '{"ok":false,"error":{"code":"forbidden","message":"Other message."}}',
    ))).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(403, Buffer.from(
      '{"ok":false,"error":{"code":"unknown_code","message":"Payout request access is not permitted."}}',
    ))).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(200, Buffer.from("not json"))).toThrow(PayoutRequestContractError)
  })

  it("rejects non-canonical JSON encodings of otherwise valid envelopes", async () => {
    const empty = JSON.parse((await fixture("get-empty-200.json")).toString("utf8"))
    const pretty = Buffer.from(JSON.stringify(empty, null, 2))
    const reordered = Buffer.from(JSON.stringify({
      payoutRequest: empty.payoutRequest,
      ok: true,
    }))

    expect(() => parsePayoutRequestResponse(200, pretty)).toThrow(PayoutRequestContractError)
    expect(() => parsePayoutRequestResponse(200, reordered)).toThrow(PayoutRequestContractError)
  })
})
