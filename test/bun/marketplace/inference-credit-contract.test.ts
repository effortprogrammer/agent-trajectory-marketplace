import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  InferenceCreditContractError,
  parseInferenceCreditDocument,
  parseInferenceCreditFinalStream,
} from "../../../src/marketplace/inference-credit-contract"

const fixtureRoot = join(import.meta.dir, "../../../contract/inference-credit/v1")
const fixture = async (name: string): Promise<Buffer> => readFile(join(fixtureRoot, name))

describe("inference credit v1 contract", () => {
  it("admits the frozen quote to final stream contract when every byte is canonical", async () => {
    // Given: the versioned quote, request, final stream, and usage fixtures.
    const [quote, request, stream, usage] = await Promise.all([
      fixture("quote-200.json"),
      fixture("request-202.json"),
      fixture("request-stream-final.sse"),
      fixture("usage-200.json"),
    ])

    // When: each public document crosses its typed boundary.
    parseInferenceCreditDocument("quote", 200, quote)
    parseInferenceCreditDocument("request", 202, request)
    const finality = parseInferenceCreditFinalStream(stream)
    parseInferenceCreditDocument("usage", 200, usage)

    // Then: the deterministic stream terminal carries the same final request ID.
    expect(finality.request.requestId).toBe("ireq-0000000000000001")
  })

  it("rejects provider-specific and private fields when a quote is parsed", async () => {
    // Given: a canonical provider-neutral quote fixture.
    const quote = await fixture("quote-200.json")
    const mutations = [
      quote.toString("utf8").replace('"provider":"relay-alpha",', '"provider":"relay-alpha","openrouterApiKey":"x",'),
      quote.toString("utf8").replace('"maximumDebitCredits":32,', '"maximumDebitCredits":32,"invoiceUsd":1,'),
      quote.toString("utf8").replace('"provider":"relay-alpha",', '"provider":"relay-alpha","providerRouting":"x",'),
    ]

    // When: a private or provider-specific field is introduced.
    // Then: strict key admission rejects every mutation.
    for (const raw of mutations) {
      expect(() => parseInferenceCreditDocument("quote", 200, Buffer.from(raw))).toThrow(InferenceCreditContractError)
    }
  })

  it("rejects noncanonical and oversized JSON when a document is parsed", async () => {
    // Given: a valid quote plus parser-differential representations.
    const quote = await fixture("quote-200.json")

    // When: byte exactness or the 64 KiB bound is violated.
    // Then: neither representation becomes a public contract value.
    expect(() => parseInferenceCreditDocument("quote", 200, Buffer.concat([quote, Buffer.from("\n")]))).toThrow(InferenceCreditContractError)
    expect(() => parseInferenceCreditDocument("quote", 200, Buffer.concat([Buffer.from("{"), Buffer.alloc(64 * 1024, 32), Buffer.from("}")]))).toThrow(InferenceCreditContractError)
  })

  it("rejects a stream whose terminal sentinel is changed", async () => {
    // Given: a canonical finality stream.
    const stream = await fixture("request-stream-final.sse")

    // When: the deterministic terminal sentinel is altered.
    const altered = Buffer.from(stream.toString("utf8").replace("data: [DONE]\n", "data: done\n"))

    // Then: the stream fails closed rather than inferring finality.
    expect(() => parseInferenceCreditFinalStream(altered)).toThrow(InferenceCreditContractError)
  })
})
