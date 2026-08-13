import { afterEach, describe, expect, test } from "bun:test"

import { WorldClientError, createWorldClient } from "../../../src/worlds/client"

const servers: Bun.Server<undefined>[] = []
afterEach(() => { for (const server of servers.splice(0)) server.stop(true) })

const failure = async (action: () => Promise<unknown>): Promise<WorldClientError> => {
  try { await action() } catch (error) {
    if (error instanceof WorldClientError) return error
    throw error
  }
  throw new Error("expected WorldClientError")
}

describe("registry World HTTP client", () => {
  test("uses bearer only for contract delivery and sends exact hosted pins", async () => {
    // Given: canonical routes recording public and protected requests.
    const requests: Array<Readonly<{ method: string; path: string; authorization: string | null; digest: string | null }>> = []
    const server = Bun.serve({ fetch(request) {
      const url = new URL(request.url)
      requests.push({
        method: request.method, path: url.pathname,
        authorization: request.headers.get("authorization"), digest: request.headers.get("x-world-pack-digest"),
      })
      if (url.pathname === "/v1/marketplace/worlds") return Response.json({ worlds: [] })
      return Response.json({
        ok: true, result: {
          instanceId: "instance-7f1a9c2e",
          packDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          status: "active", revision: 0,
        },
      })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const client = createWorldClient(`http://127.0.0.1:${server.port}`)

    // When: public catalog and protected contract-hosted requests are made.
    await client.catalog()
    await client.createHostedInstance({
      accessToken: "access-token", contractId: "00000000-0000-4000-8000-000000000002",
      packDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      idempotencyKey: "create-1", body: { seed: 7 },
    })

    // Then: only the authenticated operation receives bearer and immutable digest pins.
    expect(requests).toEqual([
      { method: "GET", path: "/v1/marketplace/worlds", authorization: null, digest: null },
      {
        method: "POST",
        path: "/v1/marketplace/buyer/world-contracts/00000000-0000-4000-8000-000000000002/hosted/instances",
        authorization: "Bearer access-token",
        digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    ])
  })

  test("classifies a caller-owned in-flight abort as cancelled", async () => {
    // Given: a request that has reached the registry and an independently-owned abort signal.
    const requestArrived = Promise.withResolvers<void>()
    const responseCancelled = Promise.withResolvers<void>()
    const server = Bun.serve({ fetch() {
      requestArrived.resolve()
      return new Response(new ReadableStream<Uint8Array>({
        cancel() {
          responseCancelled.resolve()
        },
      }), { headers: { "content-type": "application/json" } })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const controller = new AbortController()
    const action = createWorldClient(`http://127.0.0.1:${server.port}`, controller.signal).catalog()
    await requestArrived.promise

    // When: the caller aborts after transport startup.
    controller.abort()
    const error = await failure(() => action)
    const bodyCancellation = await Promise.race([
      responseCancelled.promise.then(() => "cancelled" as const),
      new Promise<"deadline">((resolve) => {
        AbortSignal.timeout(250).addEventListener("abort", () => resolve("deadline"), { once: true })
      }),
    ])

    // Then: cancellation wins over timeout and closes the received response.
    expect({ bodyCancellation, code: error.code, status: error.status }).toEqual({
      bodyCancellation: "cancelled", code: "cancelled", status: 0,
    })
  })

  test("maps empty delivery denials and oversized bodies to stable redacted errors", async () => {
    // Given: delivery authorization denial and overlarge public response.
    let count = 0
    const server = Bun.serve({ fetch() {
      count += 1
      return count === 1
        ? new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 422 })
    }, hostname: "127.0.0.1", port: 0 })
    servers.push(server)
    const client = createWorldClient(`http://127.0.0.1:${server.port}`)

    // When: public catalog and protected delivery are read.
    const oversized = await failure(() => client.catalog())
    const incompatible = await failure(() => client.issueEntitlement({
      accessToken: "access-token", contractId: "00000000-0000-4000-8000-000000000002",
      requestedScope: "hosted_execute", idempotencyKey: "issue-1",
    }))

    // Then: no response body can leak and callers receive the exact status class.
    expect({ code: oversized.code, status: oversized.status, message: oversized.message }).toEqual(
      { code: "invalid_response", status: 200, message: "invalid_response" },
    )
    expect({ code: incompatible.code, status: incompatible.status, message: incompatible.message }).toEqual(
      { code: "incompatible", status: 422, message: "incompatible" },
    )
  })
})
