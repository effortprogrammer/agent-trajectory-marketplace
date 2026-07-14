import { afterAll, describe, expect, test } from "bun:test"

import { PrivacyFilterUnavailableError } from "../src/trajectory/privacy/contract"
import { createEnginePrivacyFilter } from "../src/trajectory/privacy/engine-client"

// Fake local engine: /detect echoes one configurable response.
let respondWith: (texts: readonly string[]) => Response = () => Response.json({ spans: [] })

const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    if (new URL(request.url).pathname !== "/detect") {
      return new Response("not found", { status: 404 })
    }
    const body = (await request.json()) as { texts: readonly string[] }
    return respondWith(body.texts)
  },
})
const baseUrl = `http://127.0.0.1:${server.port}`

afterAll(() => {
  server.stop(true)
})

describe("engine privacy filter client", () => {
  test("maps engine spans onto the PrivacyFilter contract", async () => {
    respondWith = (texts) =>
      Response.json({
        spans: texts.map((text) =>
          text.includes("jane") ? [{ start: 0, end: 4, category: "email", score: 0.97 }] : [],
        ),
      })
    const filter = createEnginePrivacyFilter(baseUrl)
    const results = await filter.detect(["jane@example.com", "clean"])
    expect(results[0]).toEqual([{ start: 0, end: 4, category: "email", score: 0.97 }])
    expect(results[1]).toEqual([])
  })

  test("engine errors surface as PrivacyFilterUnavailableError", async () => {
    respondWith = () => new Response("boom", { status: 500 })
    const filter = createEnginePrivacyFilter(baseUrl)
    expect(filter.detect(["x"])).rejects.toBeInstanceOf(PrivacyFilterUnavailableError)
  })

  test("a response that does not match the contract fails closed", async () => {
    respondWith = () => Response.json({ spans: [[{ start: 0, end: 2, category: "wizardry" }]] })
    const filter = createEnginePrivacyFilter(baseUrl)
    expect(filter.detect(["x"])).rejects.toBeInstanceOf(PrivacyFilterUnavailableError)
  })

  test("a result-count mismatch fails closed", async () => {
    respondWith = () => Response.json({ spans: [] })
    const filter = createEnginePrivacyFilter(baseUrl)
    expect(filter.detect(["a", "b"])).rejects.toBeInstanceOf(PrivacyFilterUnavailableError)
  })

  test("an unreachable engine fails closed", async () => {
    const filter = createEnginePrivacyFilter("http://127.0.0.1:9")
    expect(filter.detect(["x"])).rejects.toBeInstanceOf(PrivacyFilterUnavailableError)
  })
})
