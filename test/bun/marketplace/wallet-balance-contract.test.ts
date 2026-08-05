import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  WalletBalanceContractError,
  parseWalletBalanceResponse,
  walletBalanceErrorResponseSchema,
  walletBalanceResponseSchema,
} from "../../../src/marketplace/wallet-balance-contract"

const fixtureRoot = join(import.meta.dir, "../../../contract/wallet-balance/v1")
const fixture = async (name: string): Promise<Buffer> => readFile(join(fixtureRoot, name))

describe("wallet balance v1 contract", () => {
  it("accepts every frozen fixture byte-for-byte", async () => {
    const balance = await fixture("balance-200.json")
    const unauthorized = await fixture("error-401.json")
    const forbidden = await fixture("error-403.json")

    expect(parseWalletBalanceResponse(200, balance)).toEqual(walletBalanceResponseSchema.parse(JSON.parse(balance.toString("utf8"))))
    expect(parseWalletBalanceResponse(401, unauthorized)).toEqual(walletBalanceErrorResponseSchema.parse(JSON.parse(unauthorized.toString("utf8"))))
    expect(parseWalletBalanceResponse(403, forbidden)).toEqual(walletBalanceErrorResponseSchema.parse(JSON.parse(forbidden.toString("utf8"))))
  })

  it("rejects invalid aggregate values and malformed timestamps", () => {
    const valid = {
      ok: true,
      wallet: {
        currency: "USD",
        pendingCredits: 0,
        availableCredits: 0,
        reservedCredits: 0,
        lifetimeRedeemedCredits: 0,
        nextDistributionAt: null,
      },
    }
    const invalid = [
      { ...valid, extra: true },
      { ...valid, wallet: { ...valid.wallet, pendingCredits: 1.5 } },
      { ...valid, wallet: { ...valid.wallet, availableCredits: -1 } },
      { ...valid, wallet: { ...valid.wallet, reservedCredits: Number.MAX_SAFE_INTEGER + 1 } },
      { ...valid, wallet: { ...valid.wallet, currency: "EUR" } },
      { ...valid, wallet: { ...valid.wallet, nextDistributionAt: "2030-01-02 03:04:05" } },
    ]

    for (const input of invalid) expect(() => walletBalanceResponseSchema.parse(input)).toThrow()
  })

  it("maps only frozen success and error statuses", async () => {
    const balance = await fixture("balance-200.json")
    const unauthorized = await fixture("error-401.json")

    expect(() => parseWalletBalanceResponse(200, Buffer.from('{"ok":true,"wallet":{}}'))).toThrow(WalletBalanceContractError)
    expect(() => parseWalletBalanceResponse(401, balance)).toThrow(WalletBalanceContractError)
    expect(() => parseWalletBalanceResponse(403, unauthorized)).toThrow(WalletBalanceContractError)
    expect(() => parseWalletBalanceResponse(500, unauthorized)).toThrow(WalletBalanceContractError)
  })
})
