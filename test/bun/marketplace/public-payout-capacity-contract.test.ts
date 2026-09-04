import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"
// @ts-expect-error Browser JavaScript contract module is exercised directly by Bun.
import * as publicPayoutCapacity from "../../../web/public-payout-capacity.js"

const {
  parsePublicPayoutCapacity,
  PublicPayoutCapacityContractError,
} = publicPayoutCapacity

const frameSchema = z.object({
  body: z.string(),
  method: z.literal("GET"),
  name: z.literal("public-payout-capacity-200"),
  path: z.literal("/v1/marketplace/public-payout-capacity"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.literal(200),
}).strict()
const manifestSchema = z.object({
  frames: z.tuple([frameSchema]),
  schemaVersion: z.literal(1),
}).strict()

test("public payout manifest freezes the anonymous aggregate bytes", async () => {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(
    import.meta.dir,
    "../../../contract/public-payout-capacity/v1/manifest.json",
  ), "utf8")))
  const [frame] = manifest.frames

  expect(createHash("sha256").update(frame.body).digest("hex")).toBe(
    frame.sha256,
  )
  expect(parsePublicPayoutCapacity(JSON.parse(frame.body))).toEqual({
    currency: "USD",
    limitMinor: 20_000,
    payoutRemainingMinor: 12_000,
    scope: "platform",
    windowSeconds: 604_800,
  })
})

test("public payout parser rejects over-limit or expanded projections", () => {
  const capacity = {
    currency: "USD",
    limitMinor: 20_000,
    payoutRemainingMinor: 20_001,
    scope: "platform",
    windowSeconds: 604_800,
  }

  expect(() => parsePublicPayoutCapacity({
    ok: true,
    payoutCapacity: capacity,
  })).toThrow(PublicPayoutCapacityContractError)
  expect(() => parsePublicPayoutCapacity({
    ok: true,
    payoutCapacity: { ...capacity, payoutRemainingMinor: 12_000 },
    sessionValueRemainingMinor: 5_000,
  })).toThrow(PublicPayoutCapacityContractError)
})
