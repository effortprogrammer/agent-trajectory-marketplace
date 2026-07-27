import { describe, expect, it } from "bun:test"

import {
  PublishWireContractError,
  encodePublishResponse,
  parsePublishResponse,
  publishErrorCodeForHttpStatus,
} from "../../../src/marketplace/publish-contract"

const submissionId = "sub_0123456789abcdefghjkmnpqrs"

describe("publish response contract", () => {
  it("encodes byte-identical replay-safe receipts in frozen property order", () => {
    // Given
    const receipt = {
      protocolVersion: 1,
      submissionId,
      status: "accepted" as const,
      statusUrl: `/v1/marketplace/seller/candidates/${submissionId}`,
    }

    // When
    const first = encodePublishResponse(receipt)
    const second = encodePublishResponse(receipt)

    // Then
    expect(first.equals(second)).toBe(true)
    expect(first.toString("utf8")).toBe(
      `{\"protocolVersion\":1,\"submissionId\":\"${submissionId}\",\"status\":\"accepted\",\"statusUrl\":\"/v1/marketplace/seller/candidates/${submissionId}\"}`,
    )
  })

  it("rejects unknown fields oversize bodies and wrong status mappings", () => {
    // Given
    const validError = Buffer.from('{"protocolVersion":1,"code":"invalid_candidate"}', "utf8")
    const unknownField = Buffer.from('{"protocolVersion":1,"code":"invalid_candidate","requestId":"forbidden"}', "utf8")
    const oversized = Buffer.alloc(64 * 1024 + 1, 0x20)

    // When
    const parseUnknown = (): void => {
      parsePublishResponse(400, unknownField)
    }
    const parseOversized = (): void => {
      parsePublishResponse(400, oversized)
    }
    const parseWrongMapping = (): void => {
      parsePublishResponse(401, validError)
    }

    // Then
    for (const action of [parseUnknown, parseOversized, parseWrongMapping]) {
      expect(action).toThrow(PublishWireContractError)
    }
    expect(publishErrorCodeForHttpStatus(500)).toEqual({ status: 503, code: "unavailable" })
  })

  it("freezes every HTTP error mapping and rejects invalid public identifiers", () => {
    // Given
    const expectedMappings = [
      [400, { status: 400, code: "invalid_candidate" }],
      [401, { status: 401, code: "unauthorized" }],
      [404, { status: 404, code: "not_found" }],
      [409, { status: 409, code: "idempotency_conflict" }],
      [413, { status: 413, code: "payload_too_large" }],
      [429, { status: 429, code: "rate_limited" }],
      [503, { status: 503, code: "unavailable" }],
    ] as const
    const absoluteStatusUrl = {
      protocolVersion: 1,
      submissionId,
      status: "accepted" as const,
      statusUrl: `https://registry.example/v1/marketplace/seller/candidates/${submissionId}`,
    }
    const invalidSubmissionId = {
      protocolVersion: 1,
      submissionId: "sub_0123456789abcdefghijklmnopqr",
      status: "accepted" as const,
      statusUrl: "/v1/marketplace/seller/candidates/sub_0123456789abcdefghijklmnopqr",
    }

    // When
    const mappings = expectedMappings.map(([status]) => publishErrorCodeForHttpStatus(status))
    const encodeAbsoluteUrl = (): void => {
      encodePublishResponse(absoluteStatusUrl)
    }
    const encodeInvalidId = (): void => {
      encodePublishResponse(invalidSubmissionId)
    }

    // Then
    expect(mappings).toEqual(expectedMappings.map(([, mapping]) => mapping))
    expect(encodeAbsoluteUrl).toThrow(PublishWireContractError)
    expect(encodeInvalidId).toThrow(PublishWireContractError)
  })
})
