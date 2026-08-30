import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  PayoutRequestClientError,
  createPayoutRequestClient,
  generatePayoutOperationId,
} from "../../../src/marketplace/payout-request-client"
import type { PayoutRequestEnvelope } from "../../../src/marketplace/payout-request-contract"

const fixtureRoot = join(import.meta.dir, "../../../contract/payout-request/v1")
const fixture = async (name: string): Promise<string> =>
  (await readFile(join(fixtureRoot, name))).toString("utf8")

const servers: Bun.Server<undefined>[] = []
const canonicalOperationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const failure = async (action: () => Promise<unknown>): Promise<PayoutRequestClientError> => {
  try { await action() } catch (error) {
    if (error instanceof PayoutRequestClientError) return error
    throw error
  }
  throw new Error("expected client error")
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

describe("payout request client", () => {
  test("sends the session credential on GET without any idempotency key", async () => {
    // Given: a loopback payout endpoint recording the exact wire request.
    const received: Array<Record<string, unknown>> = []
    const server = Bun.serve({ async fetch(request) {
      received.push({
        authorization: request.headers.get("authorization"),
        idempotencyKey: request.headers.get("idempotency-key"),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return new Response(await fixture("get-empty-200.json"), {
        headers: { "content-type": "application/json" }, status: 200,
      })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)

    // When: the client reads the current payout request state.
    const response = await createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
      .read({ credential: "session-sentinel" })

    // Then: exactly one credentialed GET returns the strict envelope.
    expect(received).toEqual([{
      authorization: "Bearer session-sentinel",
      idempotencyKey: null,
      method: "GET",
      path: "/v1/marketplace/seller/payout-request",
    }])
    expect(response.payoutRequest.request).toBeNull()
  })

  test("sends an exact empty JSON create with the caller's canonical operation UUID", async () => {
    // Given: a loopback create endpoint recording method, body, and headers.
    const received: Array<Record<string, unknown>> = []
    const server = Bun.serve({ async fetch(request) {
      received.push({
        body: await request.text(),
        contentType: request.headers.get("content-type"),
        idempotencyKey: request.headers.get("idempotency-key"),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return new Response(await fixture("requested-201.json"), {
        headers: { "content-type": "application/json" }, status: 201,
      })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const operationId = "00000000-0000-4000-8000-000000000201"

    // When: the client creates a payout request with that operation UUID.
    const response = await createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
      .create({ credential: "session-sentinel", operationId })

    // Then: the exact replay header and body reach the registry.
    expect(received).toEqual([{
      body: "{}",
      contentType: "application/json",
      idempotencyKey: operationId,
      method: "POST",
      path: "/v1/marketplace/seller/payout-request",
    }])
    expect(response.ok).toBe(true)
    expect(response.payoutRequest.request?.status).toBe("requested")
  })

  test("posts the withdraw action to its frozen path with the same header contract", async () => {
    // Given: a loopback withdraw endpoint.
    const received: Array<Record<string, unknown>> = []
    const server = Bun.serve({ async fetch(request) {
      received.push({
        body: await request.text(),
        idempotencyKey: request.headers.get("idempotency-key"),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return new Response(await fixture("withdrawn-200.json"), {
        headers: { "content-type": "application/json" }, status: 200,
      })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)

    // When: the client withdraws with a fresh operation UUID.
    const operationId = "00000000-0000-4000-8000-000000000202"
    const response = await createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
      .withdraw({ credential: "session-sentinel", operationId })

    // Then: the withdraw path receives the exact body and header.
    expect(received).toEqual([{
      body: "{}",
      idempotencyKey: operationId,
      method: "POST",
      path: "/v1/marketplace/seller/payout-request/withdraw",
    }])
    expect(response.payoutRequest.request?.status).toBe("cancelled")
  })

  test("generates distinct canonical operation UUIDs at the boundary", () => {
    // Given: the boundary generator.
    // When: two UUIDs are drawn.
    const first = generatePayoutOperationId()
    const second = generatePayoutOperationId()

    // Then: both are canonical v4 and never reused.
    expect(first).toMatch(canonicalOperationId)
    expect(second).toMatch(canonicalOperationId)
    expect(first).not.toBe(second)
  })

  test.each([" token ", "x\ty", ""] as const)(
    "rejects malformed credential %j before any request", async (credential) => {
      // Given: a credential that must never reach the Authorization header.
      let requests = 0
      const server = Bun.serve({ fetch() { requests += 1; return new Response("{}", { status: 200 }) }, hostname: "127.0.0.1", port: 0 })
      servers.push(server)

      // When: the client is asked to use it.
      const error = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
        .read({ credential }))

      // Then: validation fails locally with zero transport.
      expect({ code: error.code, requests, status: error.status })
        .toEqual({ code: "missing_session_credential", requests: 0, status: 0 })
    })

  test.each(["not-a-uuid", "00000000-0000-4000-8000-000000000201-extra", "ABCDEFAB-0000-4000-8000-000000000201"] as const)(
    "rejects malformed operation id %j before any request", async (operationId) => {
      // Given: an operation UUID that must never reach the Idempotency-Key header.
      let requests = 0
      const server = Bun.serve({ fetch() { requests += 1; return new Response("{}", { status: 200 }) }, hostname: "127.0.0.1", port: 0 })
      servers.push(server)

      // When: create and withdraw are attempted with it.
      const create = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
        .create({ credential: "session-sentinel", operationId }))
      const withdraw = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
        .withdraw({ credential: "session-sentinel", operationId }))

      // Then: both fail locally with zero transport.
      expect({ code: create.code, requests, status: create.status })
        .toEqual({ code: "invalid_operation_id", requests: 0, status: 0 })
      expect({ code: withdraw.code, requests }).toEqual({ code: "invalid_operation_id", requests: 0 })
    })

  test("preserves registry error envelopes with code, message, and status", async () => {
    // Given: a registry below-threshold rejection.
    const body = await fixture("error-422-below-threshold.json")
    const server = Bun.serve({ fetch() {
      return new Response(body, { headers: { "content-type": "application/json" }, status: 422 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)

    // When: the client calls create against it.
    const error = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
      .create({ credential: "session-sentinel", operationId: "00000000-0000-4000-8000-000000000203" }))

    // Then: the frozen registry error survives the boundary unchanged.
    expect({ code: error.code, registry: error.registry, status: error.status }).toEqual({
      code: "registry_error",
      registry: { code: "below_payout_threshold", message: "At least USD 100.00 is required to request payout." },
      status: 422,
    })
  })

  test("carries integer Retry-After seconds and fails closed without the header", async () => {
    // Given: two rate-limited registries, one with and one without Retry-After.
    const body = await fixture("error-429-rate-limited.json")
    const withHeader = Bun.serve({ fetch() {
      return new Response(body, { headers: { "content-type": "application/json", "retry-after": "60" }, status: 429 })
    }, hostname: "127.0.0.1", port: 0 })
    const withoutHeader = Bun.serve({ fetch() {
      return new Response(body, { headers: { "content-type": "application/json" }, status: 429 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(withHeader, withoutHeader)

    // When: the client mutates against both.
    const rateLimited = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${withHeader.port}`)
      .create({ credential: "session-sentinel", operationId: "00000000-0000-4000-8000-000000000204" }))
    const malformed = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${withoutHeader.port}`)
      .create({ credential: "session-sentinel", operationId: "00000000-0000-4000-8000-000000000204" }))

    // Then: the integer seconds are exposed and a missing header fails closed.
    expect({ code: rateLimited.code, retryAfterSeconds: rateLimited.retryAfterSeconds, status: rateLimited.status })
      .toEqual({ code: "registry_error", retryAfterSeconds: 60, status: 429 })
    expect(malformed.code).toBe("invalid_response")
  })

  test("retains one operation UUID across an unknown-result retry", async () => {
    // Given: a create endpoint whose first response never resolves.
    const keys: string[] = []
    let requests = 0
    let arrived!: () => void
    const arrival = new Promise<void>((resolve) => { arrived = resolve })
    const server = Bun.serve({ fetch(request) {
      requests += 1
      keys.push(request.headers.get("idempotency-key") ?? "")
      if (requests === 1) {
        arrived()
        return new Promise<Response>(() => {})
      }
      return new Response(requestedBody, { headers: { "content-type": "application/json" }, status: 201 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const requestedBody = await fixture("requested-201.json")
    const operationId = "00000000-0000-4000-8000-000000000205"
    const client = createPayoutRequestClient(`http://127.0.0.1:${server.port}`)
    const controller = new AbortController()

    // When: the first create is aborted mid-flight and retried with the same UUID.
    const pending = failure(() => client.create({ credential: "session-sentinel", operationId, signal: controller.signal }))
    await Promise.race([
      arrival,
      new Promise<never>((_, reject) => {
        AbortSignal.timeout(5_000).addEventListener("abort", () => reject(new Error("create never arrived")), { once: true })
      }),
    ])
    controller.abort()
    const cancelled = await pending
    const retried: PayoutRequestEnvelope = await client.create({ credential: "session-sentinel", operationId })

    // Then: both requests carried the same idempotency key and the retry resolved.
    expect(cancelled.code).toBe("cancelled")
    expect(keys).toEqual([operationId, operationId])
    expect(retried.payoutRequest.request?.requestId).toBe("00000000-0000-4000-8000-000000000101")
  })

  test("rejects redirects, network failures, and non-contract responses", async () => {
    // Given: a redirect source, a stopped endpoint, and a non-contract response.
    const destination = Bun.serve({ fetch() { return new Response("{}", { status: 200 }) }, hostname: "127.0.0.1", port: 0 })
    servers.push(destination)
    const redirector = Bun.serve({ fetch() {
      return new Response(null, { headers: { location: `http://127.0.0.1:${destination.port}` }, status: 302 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(redirector)
    const invalid = Bun.serve({ fetch() {
      return new Response('{"ok":true,"extra":true}', { headers: { "content-type": "application/json" }, status: 200 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(invalid)
    const stopped = Bun.serve({ fetch() { return new Response("{}", { status: 200 }) }, hostname: "127.0.0.1", port: 0 })
    const stoppedPort = stopped.port
    stopped.stop(true)
    const operationId = "00000000-0000-4000-8000-000000000206"

    // When: the client faces each failure mode.
    const redirected = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${redirector.port}`).read({ credential: "session-sentinel" }))
    const unreachable = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${stoppedPort}`).read({ credential: "session-sentinel" }))
    const nonContract = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${invalid.port}`).read({ credential: "session-sentinel" }))
    const createNonContract = await failure(() => createPayoutRequestClient(`http://127.0.0.1:${invalid.port}`)
      .create({ credential: "session-sentinel", operationId }))

    // Then: each is classified and none is treated as success.
    expect({ code: redirected.code, status: redirected.status }).toEqual({ code: "redirect_rejected", status: 302 })
    expect(unreachable.code).toBe("request_failed")
    expect(nonContract.code).toBe("invalid_response")
    expect(createNonContract.code).toBe("invalid_response")
  })
})
