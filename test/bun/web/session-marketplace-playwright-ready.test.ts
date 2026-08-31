import { describe, expect, test } from "bun:test"

import { waitForMarketplaceHttpReady } from "./session-marketplace-playwright.fixture"

describe("Marketplace browser harness HTTP readiness", () => {
  test("requires one successful response and cancels its body", async () => {
    const requests: string[] = []
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true
        },
      }),
    )

    await waitForMarketplaceHttpReady(
      "http://127.0.0.1:4173",
      async (input) => {
        requests.push(String(input))
        return response
      },
    )

    expect(requests).toEqual(["http://127.0.0.1:4173"])
    expect(cancelled).toBe(true)
  })

  test("rejects a non-success response", async () => {
    expect(
      waitForMarketplaceHttpReady(
        "http://127.0.0.1:4173",
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow("Marketplace readiness returned HTTP 503")
  })
})
