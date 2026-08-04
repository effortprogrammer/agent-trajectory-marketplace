import ky, { isNetworkError, isTimeoutError } from "ky"

import { normalizeAuthServerUrl } from "../auth/server-url"
import { validPublishCredential } from "./publish-client"
import { WalletBalanceContractError, parseWalletBalanceResponse } from "./wallet-balance-contract"
import type { WalletBalanceResponse } from "./wallet-balance-contract"

const responseLimitBytes = 64 * 1024
const requestTimeoutMs = 10_000
const walletPath = "/v1/marketplace/seller/wallet"

type WalletBalanceClientErrorCode =
  | "cancelled"
  | "forbidden"
  | "invalid_response"
  | "missing_wallet_credential"
  | "redirect_rejected"
  | "request_failed"
  | "timeout"
  | "unauthorized"

export class WalletBalanceClientError extends Error {
  readonly name = "WalletBalanceClientError"
  constructor(readonly code: WalletBalanceClientErrorCode, readonly status: number) { super(code) }
}

export type WalletBalanceReadRequest = Readonly<{
  readonly credential: string
  readonly signal?: AbortSignal
}>
export type WalletBalanceClient = Readonly<{ read(request: WalletBalanceReadRequest): Promise<WalletBalanceResponse> }>

const validContentLength = (value: string | null): boolean =>
  value === null || (/^(0|[1-9]\d*)$/.test(value) && Number(value) <= responseLimitBytes)

const boundedBody = async (response: Response): Promise<Uint8Array> => {
  if (!validContentLength(response.headers.get("content-length"))) {
    await response.body?.cancel()
    throw new WalletBalanceClientError("invalid_response", response.status)
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > responseLimitBytes) {
        await reader.cancel()
        throw new WalletBalanceClientError("invalid_response", response.status)
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const jsonContentType = (value: string | null): boolean => value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
const isTransportError = (error: unknown): boolean => error instanceof Error && "code" in error && typeof error.code === "string"

export const createWalletBalanceClient = (server: unknown): WalletBalanceClient => {
  const normalizedServer = normalizeAuthServerUrl(server)
  return {
    read: async (request): Promise<WalletBalanceResponse> => {
      if (!validPublishCredential(request.credential)) {
        throw new WalletBalanceClientError("missing_wallet_credential", 0)
      }
      const callerAborted = (): boolean => request.signal?.aborted === true
      if (callerAborted()) throw new WalletBalanceClientError("cancelled", 0)
      const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
      const signal = request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal])
      let responseStatus = 0
      try {
        const response = await ky(`${normalizedServer}${walletPath}`, {
          headers: { authorization: `Bearer ${request.credential}` }, method: "GET", redirect: "manual", retry: 0,
          signal, throwHttpErrors: false, timeout: requestTimeoutMs,
        })
        responseStatus = response.status
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel()
          throw new WalletBalanceClientError("redirect_rejected", response.status)
        }
        if (!jsonContentType(response.headers.get("content-type"))) {
          await response.body?.cancel()
          throw new WalletBalanceClientError("invalid_response", response.status)
        }
        const parsed = parseWalletBalanceResponse(response.status, await boundedBody(response))
        if (parsed.ok) return parsed
        throw new WalletBalanceClientError(
          response.status === 401 ? "unauthorized" : "forbidden",
          response.status,
        )
      } catch (error) {
        if (error instanceof WalletBalanceClientError) throw error
        if (error instanceof WalletBalanceContractError) throw new WalletBalanceClientError("invalid_response", responseStatus)
        if (callerAborted()) throw new WalletBalanceClientError("cancelled", 0)
        if (isTimeoutError(error) || timeoutSignal.aborted) throw new WalletBalanceClientError("timeout", 0)
        if (isNetworkError(error) || isTransportError(error) || error instanceof TypeError || error instanceof DOMException) throw new WalletBalanceClientError("request_failed", 0)
        throw new WalletBalanceClientError("invalid_response", 0)
      }
    },
  }
}
