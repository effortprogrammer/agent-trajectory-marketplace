import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"
import {
  parsePayoutRequestV2Response,
} from "../../../src/marketplace/payout-request-v2-contract"
// @ts-expect-error Browser JavaScript contract module is exercised directly by Bun.
import * as consoleContract from "../../../web/console-contract.js"

const frameSchema = z.object({
  body: z.string(),
  method: z.enum(["GET", "POST"]),
  name: z.enum(["weekly-limits-300", "payout-weekly-limit-429"]),
  path: z.enum([
    "/v1/marketplace/seller/weekly-limits",
    "/v2/marketplace/seller/payout-request",
  ]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.union([z.literal(200), z.literal(429)]),
}).strict()
const manifestSchema = z.object({
  frames: z.tuple([frameSchema, frameSchema]),
  schemaVersion: z.literal(1),
}).strict()

test("weekly seller limit manifest freezes success and payout-cap bytes", async () => {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(
    import.meta.dir,
    "../../../contract/seller-weekly-limits/v1/manifest.json",
  ), "utf8")))
  const [limits, payout] = manifest.frames

  for (const frame of manifest.frames) {
    expect(createHash("sha256").update(frame.body).digest("hex")).toBe(
      frame.sha256,
    )
  }
  expect(consoleContract.parseWeeklyLimitsResponse(
    JSON.parse(limits.body),
  )).toEqual(JSON.parse(limits.body))
  expect(parsePayoutRequestV2Response(
    payout.status,
    Buffer.from(payout.body),
  )).toEqual(JSON.parse(payout.body))
})
