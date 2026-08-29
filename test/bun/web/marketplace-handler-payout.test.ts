import { expect, test } from "bun:test"
import { resolve } from "node:path"

import { parsePayoutRequestResponse } from "../../../src/marketplace/payout-request-contract"
import type { UpstreamFetch } from "../../../web/local-registry-proxy"
import {
  awaitSignal,
  createTestHandler,
  publicRoot,
  unexpectedFetch,
} from "./marketplace-handler-test-support"

const registryUrl = "https://registry.example"
const payoutPath = "/api/registry/v1/marketplace/seller/payout-request"
const operationId = "00000000-0000-4000-8000-000000000301"

const fixture = (name: string): Promise<string> =>
  Bun.file(resolve(publicRoot, `contract/payout-request/v1/${name}`)).text()

test("Given a seller session When payout state is read Then the exact Registry GET is observed", async () => {
  const observed = Promise.withResolvers<Request>()
  const registryFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return new Response(await fixture("get-empty-200.json"), {
      headers: { "content-type": "application/json" },
    })
  }
  const handler = await createTestHandler({ registryFetch, registryUrl })

  const responsePromise = handler(new Request(`https://getatm.io${payoutPath}`, {
    headers: { authorization: "Bearer session-sentinel" },
  }))
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.url).toBe(
    "https://registry.example/v1/marketplace/seller/payout-request",
  )
  expect(upstreamRequest.method).toBe("GET")
  expect(upstreamRequest.headers.get("authorization")).toBe(
    "Bearer session-sentinel",
  )
  expect(response.status).toBe(200)
})

test("Given an eligible seller When payout is requested Then exact idempotency is forwarded", async () => {
  const observed = Promise.withResolvers<Request>()
  const registryFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return new Response(await fixture("requested-201.json"), {
      headers: { "content-type": "application/json" },
      status: 201,
    })
  }
  const handler = await createTestHandler({ registryFetch, registryUrl })
  const request = new Request(`https://getatm.io${payoutPath}`, {
    body: "{}",
    headers: {
      authorization: "Bearer session-sentinel",
      "content-type": "application/json",
      "idempotency-key": operationId,
    },
    method: "POST",
  })

  const responsePromise = handler(request)
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.method).toBe("POST")
  expect(upstreamRequest.headers.get("idempotency-key")).toBe(operationId)
  expect(await upstreamRequest.text()).toBe("{}")
  const envelope = parsePayoutRequestResponse(
    response.status,
    Buffer.from(await response.text()),
  )
  if (!envelope.ok) throw new Error("expected payout request envelope")
  expect(envelope.payoutRequest.request?.status).toBe("requested")
})

test("Given a requested payout When withdrawn Then exact action path is forwarded", async () => {
  const observed = Promise.withResolvers<Request>()
  const registryFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return new Response(await fixture("withdrawn-200.json"), {
      headers: { "content-type": "application/json" },
    })
  }
  const handler = await createTestHandler({ registryFetch, registryUrl })
  const request = new Request(`https://getatm.io${payoutPath}/withdraw`, {
    body: "{}",
    headers: {
      "content-type": "application/json",
      "idempotency-key": operationId,
    },
    method: "POST",
  })

  const responsePromise = handler(request)
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.url).toBe(
    "https://registry.example/v1/marketplace/seller/payout-request/withdraw",
  )
  expect(response.status).toBe(200)
})

test("Given payout routes When an unsupported method is used Then it is rejected locally", async () => {
  const handler = await createTestHandler({
    registryFetch: unexpectedFetch,
    registryUrl,
  })

  const response = await handler(new Request(`https://getatm.io${payoutPath}`, {
    method: "PUT",
  }))

  expect(response.status).toBe(405)
  expect(response.headers.get("allow")).toBe("GET, POST")
})

test("Given a payout create When body is nonempty Then it is rejected locally", async () => {
  const handler = await createTestHandler({
    registryFetch: unexpectedFetch,
    registryUrl,
  })

  const response = await handler(new Request(`https://getatm.io${payoutPath}`, {
    body: JSON.stringify({ amountMinor: 1 }),
    headers: {
      "content-type": "application/json",
      "idempotency-key": operationId,
    },
    method: "POST",
  }))

  expect(response.status).toBe(400)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.text()).toBe(
    await fixture("error-400-invalid-request.json"),
  )
})
