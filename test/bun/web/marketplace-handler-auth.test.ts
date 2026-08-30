import { expect, test } from "bun:test"

import type { UpstreamFetch } from "../../../web/local-registry-proxy"
import {
  awaitSignal,
  createTestHandler,
  unexpectedFetch,
} from "./marketplace-handler-test-support"

const registryUrl = "https://registry.example"

test("Given Registry login configuration When posted Then exact auth request is forwarded", async () => {
  const observed = Promise.withResolvers<Request>()
  const registryFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return Response.json({
      challengeId: "chal-0123456789abcdef",
      expiresAt: "2030-01-01T00:00:00.000Z",
      ok: true,
    })
  }
  const handler = await createTestHandler({ registryFetch, registryUrl })
  const request = new Request("https://getatm.io/api/registry/v1/auth/login", {
    body: JSON.stringify({ email: "owner@example.test" }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  })

  const responsePromise = handler(request)
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.url).toBe("https://registry.example/v1/auth/login")
  expect(upstreamRequest.method).toBe("POST")
  expect(upstreamRequest.headers.get("content-type")).toBe("application/json")
  expect(await upstreamRequest.json()).toEqual({ email: "owner@example.test" })
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
})

test("Given Registry signup configuration When posted Then exact consent request is forwarded", async () => {
  const observed = Promise.withResolvers<Request>()
  const registryFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return Response.json({
      challengeId: "chal-fedcba9876543210",
      expiresAt: "2030-01-01T00:00:00.000Z",
      ok: true,
    })
  }
  const handler = await createTestHandler({ registryFetch, registryUrl })
  const request = new Request("https://getatm.io/api/registry/v1/auth/signup", {
    body: JSON.stringify({ acceptTerms: true, email: "owner@example.test" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })

  const responsePromise = handler(request)
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.url).toBe("https://registry.example/v1/auth/signup")
  expect(upstreamRequest.method).toBe("POST")
  expect(await upstreamRequest.json()).toEqual({
    acceptTerms: true,
    email: "owner@example.test",
  })
  expect(response.status).toBe(200)
})

test("Given an unapproved auth method When requested Then routing falls through without transport", async () => {
  const handler = await createTestHandler({
    registryFetch: unexpectedFetch,
    registryUrl,
  })

  const response = await handler(
    new Request("https://getatm.io/api/registry/v1/auth/signup"),
  )

  expect(response.status).toBe(404)
  expect(response.headers.get("cache-control")).toBe("no-store")
})
