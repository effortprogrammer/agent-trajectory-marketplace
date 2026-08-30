import { expect, test } from "bun:test"

import type { UpstreamFetch } from "../../../web/local-registry-proxy"
import {
  awaitSignal,
  createTestHandler,
  unexpectedFetch,
} from "./marketplace-handler-test-support"

test("Given public stats configuration When requested Then the exact upstream event is observed", async () => {
  const observed = Promise.withResolvers<Request>()
  const publicStatsFetch: UpstreamFetch = async (url, init) => {
    const request = new Request(url.toString(), init)
    observed.resolve(request)
    return Response.json({ tradeableTokens: "39048328" })
  }
  const handler = await createTestHandler({
    publicStatsFetch,
    publicStatsUrl: "https://registry.example/v1/marketplace/public-stats",
  })

  const responsePromise = handler(new Request("https://getatm.io/api/public-stats"))
  const [upstreamRequest, response] = await Promise.all([
    awaitSignal(observed.promise),
    responsePromise,
  ])

  expect(upstreamRequest.method).toBe("GET")
  expect(upstreamRequest.url).toBe(
    "https://registry.example/v1/marketplace/public-stats",
  )
  expect(upstreamRequest.headers.get("accept")).toBe("application/json")
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({ tradeableTokens: "39048328" })
})

test("Given public stats configuration When posted Then the handler rejects before transport", async () => {
  const handler = await createTestHandler({
    publicStatsFetch: unexpectedFetch,
    publicStatsUrl: "https://registry.example/v1/marketplace/public-stats",
  })

  const response = await handler(new Request("https://getatm.io/api/public-stats", {
    method: "POST",
  }))

  expect(response.status).toBe(405)
  expect(response.headers.get("allow")).toBe("GET")
  expect(response.headers.get("cache-control")).toBe("no-store")
})
