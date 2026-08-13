import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  WorldContractError,
  parseWorldResponse,
  worldCatalogDetailResponseSchema,
  worldCatalogListResponseSchema,
  worldDeliveryGrantSchema,
  worldHostedRuntimeResponseSchema,
} from "../../../src/worlds/contracts"

const root = join(import.meta.dir, "../../../contract/world/v1")
const fixture = async (name: string): Promise<Buffer> => readFile(join(root, name))

describe("registry World public contract", () => {
  test("parses every exact catalog, delivery, and hosted terminal fixture", async () => {
    // Given: canonical route responses copied from current registry projections.
    const bodies = await Promise.all([
      fixture("catalog-list-200.json"), fixture("catalog-detail-200.json"),
      fixture("entitlement-hosted-200.json"), fixture("entitlement-download-200.json"),
      fixture("hosted-create-200.json"), fixture("hosted-status-200.json"),
      fixture("hosted-error-409.json"), fixture("catalog-error-404.json"),
    ])

    // When: each response is parsed against its exact route and status.
    const parsed = [
      parseWorldResponse("catalog", 200, bodies[0] ?? Buffer.alloc(0)),
      parseWorldResponse("world", 200, bodies[1] ?? Buffer.alloc(0)),
      parseWorldResponse("issue_entitlement", 200, bodies[2] ?? Buffer.alloc(0)),
      parseWorldResponse("redeem_download", 200, bodies[3] ?? Buffer.alloc(0)),
      parseWorldResponse("hosted_create", 200, bodies[4] ?? Buffer.alloc(0)),
      parseWorldResponse("hosted_status", 200, bodies[5] ?? Buffer.alloc(0)),
      parseWorldResponse("hosted_create", 409, bodies[6] ?? Buffer.alloc(0)),
      parseWorldResponse("world", 404, bodies[7] ?? Buffer.alloc(0)),
    ]

    // Then: public values match strict schemas and server aliases.
    expect(parsed).toEqual([
      worldCatalogListResponseSchema.parse(JSON.parse((bodies[0] ?? Buffer.alloc(0)).toString())),
      worldCatalogDetailResponseSchema.parse(JSON.parse((bodies[1] ?? Buffer.alloc(0)).toString())),
      worldDeliveryGrantSchema.parse(JSON.parse((bodies[2] ?? Buffer.alloc(0)).toString())),
      worldDeliveryGrantSchema.parse(JSON.parse((bodies[3] ?? Buffer.alloc(0)).toString())),
      worldHostedRuntimeResponseSchema.parse(JSON.parse((bodies[4] ?? Buffer.alloc(0)).toString())),
      worldHostedRuntimeResponseSchema.parse(JSON.parse((bodies[5] ?? Buffer.alloc(0)).toString())),
      worldHostedRuntimeResponseSchema.parse(JSON.parse((bodies[6] ?? Buffer.alloc(0)).toString())),
      { error: "not_found" },
    ])
  })

  test("rejects unknown, malformed, terminal mismatch, and overlarge responses", async () => {
    // Given: bounded public response violations.
    const response = await fixture("hosted-status-200.json")
    const unknown = Buffer.from(`${response.toString().slice(0, -1)},"private":true}`)

    // When: they cross the exact parser boundary.
    const parse = (status: number, bytes: Uint8Array): void => { parseWorldResponse("hosted_status", status, bytes) }

    // Then: the client cannot accept a widened or status-mismatched contract.
    expect(() => parse(200, unknown)).toThrow(WorldContractError)
    expect(() => parse(409, response)).toThrow(WorldContractError)
    expect(() => parse(200, Buffer.from("{"))).toThrow(WorldContractError)
    expect(() => parse(200, Buffer.alloc(65_537))).toThrow(WorldContractError)
  })
})
