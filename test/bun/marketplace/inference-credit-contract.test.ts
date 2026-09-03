import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  encodeInferenceCreditDocument,
  InferenceCreditContractError,
  parseInferenceCreditDocument,
  parseInferenceCreditFinalStream,
} from "../../../src/marketplace/inference-credit-contract"

const fixtureRoot = join(import.meta.dir, "../../../contract/inference-credit/v1")
const fixture = async (name: string): Promise<Buffer> => readFile(join(fixtureRoot, name))

describe("inference credit v1 contract", () => {
  it("admits the frozen quote to final stream contract when every byte is canonical", async () => {
    // Given: the versioned quote, request, final stream, and usage fixtures.
    const [quote, requestCreate, request, stream, usage] = await Promise.all([
      fixture("quote-200.json"),
      fixture("request-create.json"),
      fixture("request-202.json"),
      fixture("request-stream-final.sse"),
      fixture("usage-200.json"),
    ])

    // When: each public document crosses its typed boundary.
    parseInferenceCreditDocument("quote", 200, quote)
    parseInferenceCreditDocument("request-create", 0, requestCreate)
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

  it("rejects duplicate keys, impossible calendar values, and illegal relationships", async () => {
    // Given: canonical facts mutated one relationship or JSON admission rule at a time.
    const [created, listed, quote, stream] = await Promise.all([
      fixture("key-created-201.json"), fixture("key-list-200.json"), fixture("quote-200.json"), fixture("request-stream-final.sse"),
    ])
    const invalid = [
      ["quote", 200, quote.toString("utf8").replace('"ok":true,', '"ok":true,"ok":true,')],
      ["quote", 200, quote.toString("utf8").replace("2030-01-01T03:09:05Z", "2030-99-99T99:99:99Z")],
      ["key-create", 201, created.toString("utf8").replace('"requestCeilingCredits":32', '"requestCeilingCredits":201')],
      ["key-list", 200, listed.toString("utf8").replace('"usedCredits":17', '"usedCredits":201')],
      ["quote", 200, quote.toString("utf8").replace("2030-01-01T03:09:05Z", "2030-01-01T03:03:05Z")],
    ] as const

    // When: each malformed value crosses the public contract boundary.
    // Then: duplicate, timestamp, budget, and temporal invariants fail closed.
    for (const [kind, status, raw] of invalid) {
      expect(() => parseInferenceCreditDocument(kind, status, Buffer.from(raw))).toThrow(InferenceCreditContractError)
    }
    expect(() => parseInferenceCreditFinalStream(Buffer.from(
      stream.toString("utf8").replace('"finalDebitCredits":17', '"finalDebitCredits":33'),
    ))).toThrow(InferenceCreditContractError)
  })

  it("rejects an encoder value that exceeds the 64 KiB wire cap", () => {
    // Given: a schema-valid key list whose serialized form is larger than the wire cap.
    const key = {
      keyId: "ikey-0000000000000001", status: "active", scopes: ["inference:quote"],
      models: Array.from({ length: 32 }, (_, index) => `m${String(index).padStart(3, "0")}${"a".repeat(124)}`), requestCeilingCredits: 32, budgetCredits: 200, usedCredits: 0,
      expiresAt: "2030-01-02T03:04:05Z", createdAt: "2030-01-01T03:04:05Z", revokedAt: null,
    }
    const oversized = { ok: true, keys: { items: Array.from({ length: 100 }, () => key), nextCursor: null } }

    // When: canonical serialization is requested.
    // Then: the encoder rejects instead of emitting an unparsable document.
    expect(() => encodeInferenceCreditDocument("key-list", oversized)).toThrow(InferenceCreditContractError)
  })

  it("accepts an authorized 202 request and a once-visible credential channel", async () => {
    // Given: an accepted request fact and an explicitly non-secret fixture sentinel.
    const [created, listed] = await Promise.all([
      fixture("key-created-201.json"), fixture("key-list-200.json"),
    ])
    const accepted = Buffer.from('{"ok":true,"request":{"requestId":"ireq-0000000000000001","quoteId":"iquote-0000000000000001","canonicalModel":"claude-fable-5","provider":"relay-alpha","status":"authorized","ceilingCredits":32,"finalDebitCredits":null,"usage":null,"createdAt":"2030-01-01T03:04:05Z","finalizedAt":null}}')
    // When: the accepted response and the one-time delivery body are parsed.
    // Then: they are explicit public contract values.
    expect(parseInferenceCreditDocument("request", 202, accepted)).toEqual(expect.objectContaining({ ok: true }))
    expect(parseInferenceCreditDocument("key-create", 201, created)).toEqual(expect.objectContaining({ ok: true }))
    expect(() => parseInferenceCreditDocument("key-list", 200, Buffer.from(listed.toString("utf8").replace(
      '"keyId":"ikey-0000000000000001",', '"keyId":"ikey-0000000000000001","credential":"[TEST-ONLY-ONCE-VISIBLE]",',
    )))).toThrow(InferenceCreditContractError)
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
