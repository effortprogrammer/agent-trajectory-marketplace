import { afterEach, describe, expect, test } from "bun:test"
import { createPublishClient, PublishClientError } from "../../../src/marketplace/publish-client"
import { encodeCandidateJson } from "../../../src/marketplace/publish-contract"
import { affirmCommercialUse, uploadConsentPolicyJson } from "../../../src/marketplace/upload-consent"
import {
  compensatedPublishBundle,
} from "../fixtures/compensated-publish-bundle"

const servers: Bun.Server<undefined>[] = []

const validRequest = () => {
  const bundle = compensatedPublishBundle()
  return { bundle, consent: affirmCommercialUse(bundle) }
}

const serve = (fetch: (request: Request) => Response | Promise<Response>): Bun.Server<undefined> => {
  const server = Bun.serve({
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/v1/marketplace/seller/upload-consent-policy") {
        return new Response(uploadConsentPolicyJson, { status: 200 })
      }
      const response = await fetch(request)
      if (response.status !== 202) return response
      const consent = request.headers.get("x-atm-upload-consent")
      if (consent === null) return response
      const headers = new Headers(response.headers)
      headers.set("x-atm-upload-consent-sha256", Bun.CryptoHasher.hash("sha256", Buffer.from(consent, "base64url"), "hex"))
      return new Response(response.body, { headers, status: response.status })
    },
    hostname: "127.0.0.1", port: 0,
  })
  servers.push(server)
  return server
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("candidate publish client", () => {
  test("CLI API key wins without leaking any credential sentinel", async () => {
    // Given: a loopback registry and three intentionally different credentials.
    const { bundle, consent } = validRequest()
    const expectedLength = 4
      + encodeCandidateJson(bundle.candidate).byteLength
      + bundle.archive.byteLength
    const sentinels = ["flag-sentinel", "environment-sentinel", "stored-sentinel"]
    const submissionId = `sub_${"0".repeat(26)}`
    const authorizations: string[] = []
    const lengths: Readonly<{ declared: number; received: number }>[] = []
    const server = serve(async (request) => {
      authorizations.push(request.headers.get("authorization") ?? "")
      lengths.push({
        declared: Number(request.headers.get("content-length")),
        received: (await request.arrayBuffer()).byteLength,
      })
      return Response.json({
        protocolVersion: 1,
        submissionId,
        status: "accepted",
        statusUrl: `/v1/marketplace/seller/candidates/${submissionId}`,
      }, { status: 202 })
    })

    // When: the resolved CLI credential posts the candidate frame.
    const receipt = await createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      bundle,
      consent,
      credential: sentinels[0] ?? "",
    })

    // Then: exactly one canonical request contains only the flag sentinel.
    expect({
      authorization: authorizations[0],
      count: authorizations.length,
      lengths,
      receipt,
    }).toEqual({
      authorization: "Bearer flag-sentinel",
      count: 1,
      lengths: [{ declared: expectedLength, received: expectedLength }],
      receipt: expect.objectContaining({ protocolVersion: 1, status: "accepted" }),
    })
    expect(JSON.stringify({ authorizations, receipt })).not.toContain(sentinels[1] ?? "")
    expect(JSON.stringify({ authorizations, receipt })).not.toContain(sentinels[2] ?? "")
  })

  test("rejects redirects and cancels an oversized response", async () => {
    // Given: separate registry responses outside the v1 receive contract.
    const redirectRequest = validRequest()
    const oversizedRequest = validRequest()
    const redirect = serve(() => new Response(null, { headers: { location: "https://example.test" }, status: 302 }))
    const oversized = serve(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65_537)) },
    })))

    // When: each response crosses the bounded client boundary.
    const redirectError = await expectError(() => createPublishClient(`http://127.0.0.1:${redirect.port}`).publish({
      ...redirectRequest,
      credential: "flag-sentinel",
    }))
    const oversizedError = await expectError(() => createPublishClient(`http://127.0.0.1:${oversized.port}`).publish({
      ...oversizedRequest,
      credential: "flag-sentinel",
    }))

    // Then: neither response is accepted or followed.
    expect([redirectError.code, oversizedError.code]).toEqual(["redirect_rejected", "invalid_response"])
  })

  test("normalizes the server before retaining a credentialed publish client", () => {
    // Given: a loopback origin with an unsupported path and a request counter.
    let hits = 0
    const server = serve(() => {
      hits += 1
      return new Response(null, { status: 503 })
    })

    // When: a caller tries to construct the credentialed client from that non-origin URL.
    const create = (): void => {
      createPublishClient(`http://127.0.0.1:${server.port}/unexpected`)
    }

    // Then: server validation fails synchronously, before any credential can be retained or sent.
    expect(create).toThrow()
    expect(hits).toBe(0)
  })

  test("preserves the HTTP status when a response violates the wire contract", async () => {
    // Given: a canonical request followed by malformed response bytes at HTTP 202.
    const { bundle, consent } = validRequest()
    const server = serve(() => new Response("{malformed", { status: 202 }))

    // When: the bounded response parser rejects those bytes.
    const error = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      bundle,
      consent,
      credential: "flag-sentinel",
    }))

    // Then: automation retains both the stable response code and the observed HTTP status.
    expect(error).toMatchObject({ code: "invalid_response", status: 202 })
  })

  test("preserves consumed bundle errors before a second transport", async () => {
    // Given: one admitted bundle and a canonical unavailable response.
    const request = validRequest()
    let hits = 0
    const server = serve(async (serverRequest) => {
      hits += 1
      await serverRequest.arrayBuffer()
      return Response.json({ protocolVersion: 1, code: "unavailable" }, { status: 503 })
    })

    // When: the first attempt consumes the bundle and a second attempt reuses it.
    const first = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      ...request,
      credential: "flag-sentinel",
    }))
    const second = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      ...request,
      credential: "flag-sentinel",
    }))
    const third = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      ...validRequest(),
      credential: "flag-sentinel",
    }))

    // Then: reuse fails locally, while a freshly admitted bundle makes an explicit second request.
    expect({ first: first.code, hits, second: second.code, status: second.status, third: third.code }).toEqual({
      first: "unavailable",
      hits: 2,
      second: "invalid_candidate",
      status: 0,
      third: "unavailable",
    })
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
    const { bundle, consent } = validRequest()
    const server = serve(() => Response.json({ protocolVersion: 1, code }, { status }))

    // When: the client receives the canonical non-success response.
    const error = await expectError(() => createPublishClient(`http://127.0.0.1:${server.port}`).publish({
      bundle,
      consent,
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
