import { describe, expect, test } from "bun:test"

import {
  presentCandidateRemoteError,
} from "../../../src/marketplace/candidate-remote-error"
import { PublishClientError } from "../../../src/marketplace/publish-client"
import { StatusClientError } from "../../../src/marketplace/status-client"

describe("candidate remote error presentation", () => {
  test.each([
    [new PublishClientError("weekly_upload_limit", 429), "weekly_upload_limit"],
    [new PublishClientError("rate_limited", 429), "rate_limited"],
    [new PublishClientError("invalid_candidate", 400), "invalid_candidate"],
    [new PublishClientError("unauthorized", 401), "unauthorized"],
    [new PublishClientError("not_found", 404), "not_found"],
    [new PublishClientError("payload_too_large", 413), "payload_too_large"],
    [new PublishClientError("unavailable", 503), "service_unavailable"],
    [new PublishClientError("idempotency_conflict", 409), "invalid_candidate"],
    [new StatusClientError("unavailable"), "service_unavailable"],
  ] as const)("presents remote %s as customer code %s", (remote, code) => {
    const presented = presentCandidateRemoteError(remote)
    expect(presented).toMatchObject({ code })
    expect(presented?.message.length).toBeGreaterThan(0)
  })

  test("leaves local publish failures on their existing error contract", () => {
    expect(presentCandidateRemoteError(new PublishClientError("invalid_candidate", 0))).toBeUndefined()
  })
})
