import { afterEach, describe, expect, test } from "bun:test"

import { createPublishClient, PublishClientError } from "../../../src/marketplace/publish-client"
import { createCandidateFromExactBytes } from "../../../src/marketplace/publish-contract"

const servers: Bun.Server<undefined>[] = []

const serve = (fetch: (request: Request) => Response | Promise<Response>): Bun.Server<undefined> => {
  const server = Bun.serve({ fetch, hostname: "127.0.0.1", port: 0 })
  servers.push(server)
  return server
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("candidate publish client", () => {
  test("CLI API key wins without leaking any credential sentinel", async () => {
    // Given: a loopback registry and three intentionally different credentials.
    const archive = Buffer.from("dataset bytes")
    const candidate = createCandidateFromExactBytes({ archive, artifactCount: 1, manifest: Buffer.from("manifest") })
    const sentinels = ["flag-sentinel", "environment-sentinel", "stored-sentinel"]
    const submissionId = `sub_${"0".repeat(26)}`
    const authorizations: string[] = []
    const server = serve((request) => {
      authorizations.push(request.headers.get("authorization") ?? "")
      return Response.json({
        protocolVersion: 1,
        submissionId,
        status: "accepted",
        statusUrl: `/v1/marketplace/seller/candidates/${submissionId}`,
      }, { status: 202 })
    })

    // When: the resolved CLI credential posts the candidate frame.
    const receipt = await createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      archive,
      candidate,
      credential: sentinels[0] ?? "",
    })

    // Then: exactly one canonical request contains only the flag sentinel.
    expect({
      authorization: authorizations[0],
      count: authorizations.length,
      receipt,
    }).toEqual({
      authorization: "Bearer flag-sentinel",
      count: 1,
      receipt: expect.objectContaining({ protocolVersion: 1, status: "accepted" }),
    })
    expect(JSON.stringify({ authorizations, receipt })).not.toContain(sentinels[1] ?? "")
    expect(JSON.stringify({ authorizations, receipt })).not.toContain(sentinels[2] ?? "")
  })

  test("rejects redirects and cancels an oversized response", async () => {
    // Given: separate registry responses outside the v1 receive contract.
    const archive = Buffer.from("dataset bytes")
    const candidate = createCandidateFromExactBytes({ archive, artifactCount: 1, manifest: Buffer.from("manifest") })
    const redirect = serve(() => new Response(null, { headers: { location: "https://example.test" }, status: 302 }))
    const oversized = serve(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65_537)) },
    })))

    // When: each response crosses the bounded client boundary.
    const redirectError = await expectError(() => createPublishClient(`http://127.0.0.1:${redirect.port}`).publish({ archive, candidate, credential: "flag-sentinel" }))
    const oversizedError = await expectError(() => createPublishClient(`http://127.0.0.1:${oversized.port}`).publish({ archive, candidate, credential: "flag-sentinel" }))

    // Then: neither response is accepted or followed.
    expect([redirectError.code, oversizedError.code]).toEqual(["redirect_rejected", "invalid_response"])
  })

  test.each([
    [400, "invalid_candidate"],
    [401, "unauthorized"],
    [404, "not_found"],
    [409, "idempotency_conflict"],
    [413, "payload_too_large"],
    [429, "rate_limited"],
    [503, "unavailable"],
  ] as const)("preserves canonical HTTP %i error code %s", async (status, code) => {
    // Given: a registry response accepted by the frozen publish-wire error contract.
    const archive = Buffer.from("dataset bytes")
    const candidate = createCandidateFromExactBytes({ archive, artifactCount: 1, manifest: Buffer.from("manifest") })
    const server = serve(() => Response.json({ protocolVersion: 1, code }, { status }))

    // When: the client receives the canonical non-success response.
    const error = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      archive,
      candidate,
      credential: "flag-sentinel",
    }))

    // Then: callers retain both the machine-readable contract code and HTTP status.
    expect(error).toMatchObject({ code, status })
  })
})

const expectError = async (action: () => Promise<unknown>): Promise<PublishClientError> => {
  try {
    await action()
  } catch (error) {
    if (error instanceof PublishClientError) return error
    throw error
  }
  throw new TypeError("expected PublishClientError")
}
