import { z } from "zod"

import { authErrorResponseSchema } from "../auth/contract"

const maximumSafeInteger = Number.MAX_SAFE_INTEGER
const nonnegativeSafeIntegerSchema = z.number().int().min(0).max(maximumSafeInteger)
const walletBalanceTimestampSchema = z.string().datetime({ offset: true })

export const walletBalanceSchema = z
  .object({
    currency: z.literal("USD"),
    pendingCredits: nonnegativeSafeIntegerSchema,
    availableCredits: nonnegativeSafeIntegerSchema,
    reservedCredits: nonnegativeSafeIntegerSchema,
    lifetimeRedeemedCredits: nonnegativeSafeIntegerSchema,
    nextDistributionAt: walletBalanceTimestampSchema.nullable(),
  })
  .strict()

export const walletBalanceResponseSchema = z
  .object({
    ok: z.literal(true),
    wallet: walletBalanceSchema,
  })
  .strict()

export const walletBalanceErrorResponseSchema = authErrorResponseSchema

export type WalletBalance = z.infer<typeof walletBalanceSchema>
export type WalletBalanceResponse = z.infer<typeof walletBalanceResponseSchema>
export type WalletBalanceErrorResponse = z.infer<typeof walletBalanceErrorResponseSchema>
export type WalletBalanceHttpResponse = WalletBalanceResponse | WalletBalanceErrorResponse

export class WalletBalanceContractError extends Error {
  public readonly name = "WalletBalanceContractError"
  public constructor() { super("invalid_response") }
}

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new WalletBalanceContractError()
  }
}

export const encodeWalletBalanceResponse = (input: unknown): Buffer => {
  const success = walletBalanceResponseSchema.safeParse(input)
  if (success.success) {
    const { wallet } = success.data
    return Buffer.from(JSON.stringify({
      ok: true,
      wallet: {
        currency: wallet.currency,
        pendingCredits: wallet.pendingCredits,
        availableCredits: wallet.availableCredits,
        reservedCredits: wallet.reservedCredits,
        lifetimeRedeemedCredits: wallet.lifetimeRedeemedCredits,
        nextDistributionAt: wallet.nextDistributionAt,
      },
    }), "utf8")
  }
  const failure = walletBalanceErrorResponseSchema.safeParse(input)
  if (!failure.success) throw new WalletBalanceContractError()
  const { error } = failure.data
  return Buffer.from(JSON.stringify({
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    },
  }), "utf8")
}

export const parseWalletBalanceResponse = (status: number, bytes: Uint8Array): WalletBalanceHttpResponse => {
  const input = parseJson(bytes)
  let response: WalletBalanceHttpResponse
  if (status === 200) {
    const parsed = walletBalanceResponseSchema.safeParse(input)
    if (!parsed.success) throw new WalletBalanceContractError()
    response = parsed.data
  } else if (status === 401 || status === 403) {
    const parsed = walletBalanceErrorResponseSchema.safeParse(input)
    if (!parsed.success) throw new WalletBalanceContractError()
    const expectedCode = status === 401 ? "unauthorized" : "forbidden"
    if (parsed.data.error.code !== expectedCode) throw new WalletBalanceContractError()
    response = parsed.data
  } else {
    throw new WalletBalanceContractError()
  }
  if (!Buffer.from(bytes).equals(encodeWalletBalanceResponse(response))) {
    throw new WalletBalanceContractError()
  }
  return response
}
