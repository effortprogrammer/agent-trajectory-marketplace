import ky, { isNetworkError, isTimeoutError } from "ky"

import { normalizeAuthServerUrl } from "../auth/server-url"
import { validPublishCredential } from "./publish-client"
import {
  PayoutRequestContractError,
  isValidPayoutOperationId,
  parsePayoutRequestResponse,
} from "./payout-request-contract"
import type { PayoutRequestEnvelope } from "./payout-request-contract"

const responseLimitBytes = 64 * 1024
const requestTimeoutMs = 10_000
const basePath = "/v1/marketplace/seller/payout-request"
const withdrawPath = `${basePath}/withdraw`

type PayoutRequestClientErrorCode =
  | "cancelled"
  | "invalid_operation_id"
  | "invalid_response"
  | "missing_session_credential"
  | "redirect_rejected"
  | "registry_error"
  | "request_failed"
  | "timeout"

export class PayoutRequestClientError extends Error {
  readonly name = "PayoutRequestClientError"
  constructor(
    readonly code: PayoutRequestClientErrorCode,
    readonly status: number,
    readonly registry?: Readonly<{ code: string; message: string }>,
    readonly retryAfterSeconds?: number,
  ) { super(code) }
}

export type PayoutRequestReadRequest = Readonly<{
  readonly credential: string
  readonly signal?: AbortSignal
}>

export type PayoutRequestMutationRequest = Readonly<{
  readonly credential: string
  readonly operationId: string
  readonly signal?: AbortSignal
}>

export type PayoutRequestClient = Readonly<{
  read(request: PayoutRequestReadRequest): Promise<PayoutRequestEnvelope>
  create(request: PayoutRequestMutationRequest): Promise<PayoutRequestEnvelope>
  withdraw(request: PayoutRequestMutationRequest): Promise<PayoutRequestEnvelope>
}>

export const generatePayoutOperationId = (): string => crypto.randomUUID()

const validContentLength = (value: string | null): boolean =>
  value === null || (/^(0|[1-9]\d*)$/.test(value) && Number(value) <= responseLimitBytes)

const boundedBody = async (response: Response): Promise<Uint8Array> => {
  if (!validContentLength(response.headers.get("content-length"))) {
    await response.body?.cancel()
    throw new PayoutRequestClientError("invalid_response", response.status)
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
        throw new PayoutRequestClientError("invalid_response", response.status)
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

const jsonContentType = (value: string | null): boolean =>
  value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
const isTransportError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string"
const retryAfterSeconds = (value: string | null): number => {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new PayoutRequestClientError("invalid_response", 429)
  }
  return Number(value)
}

type WireCall = Readonly<
  | { readonly credential: string; readonly method: "GET"; readonly path: string; readonly signal?: AbortSignal }
  | {
      readonly credential: string
      readonly method: "POST"
      readonly operationId: string
      readonly path: string
      readonly signal?: AbortSignal
    }
>

const wireRequest = async (server: string, call: WireCall): Promise<PayoutRequestEnvelope> => {
  if (!validPublishCredential(call.credential)) {
    throw new PayoutRequestClientError("missing_session_credential", 0)
  }
  if (call.method === "POST" && !isValidPayoutOperationId(call.operationId)) {
    throw new PayoutRequestClientError("invalid_operation_id", 0)
  }
  const callerAborted = (): boolean => call.signal?.aborted === true
  if (callerAborted()) throw new PayoutRequestClientError("cancelled", 0)
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
  const signal = call.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([call.signal, timeoutSignal])
  let responseStatus = 0
  try {
    const response = await ky(`${server}${call.path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${call.credential}`,
        ...(call.method === "POST"
          ? { "content-type": "application/json", "idempotency-key": call.operationId }
          : {}),
      },
      json: call.method === "POST" ? {} : undefined,
      method: call.method,
      redirect: "manual",
      retry: 0,
      signal,
      throwHttpErrors: false,
      timeout: requestTimeoutMs,
    })
    responseStatus = response.status
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new PayoutRequestClientError("redirect_rejected", response.status)
    }
    if (!jsonContentType(response.headers.get("content-type"))) {
      await response.body?.cancel()
      throw new PayoutRequestClientError("invalid_response", response.status)
    }
    const parsed = parsePayoutRequestResponse(response.status, await boundedBody(response))
    if (parsed.ok) return parsed
    const registry = { code: parsed.error.code, message: parsed.error.message }
    if (response.status === 429) {
      throw new PayoutRequestClientError("registry_error", response.status, registry, retryAfterSeconds(response.headers.get("retry-after")))
    }
    throw new PayoutRequestClientError("registry_error", response.status, registry)
  } catch (error) {
    if (error instanceof PayoutRequestClientError) throw error
    if (error instanceof PayoutRequestContractError) throw new PayoutRequestClientError("invalid_response", responseStatus)
    if (callerAborted()) throw new PayoutRequestClientError("cancelled", 0)
    if (isTimeoutError(error) || timeoutSignal.aborted) throw new PayoutRequestClientError("timeout", 0)
    if (isNetworkError(error) || isTransportError(error) || error instanceof TypeError || error instanceof DOMException) {
      throw new PayoutRequestClientError("request_failed", 0)
    }
    throw new PayoutRequestClientError("invalid_response", 0)
  }
}

export const createPayoutRequestClient = (server: unknown): PayoutRequestClient => {
  const normalizedServer = normalizeAuthServerUrl(server)
  return {
    read: (request) => wireRequest(normalizedServer, {
      credential: request.credential, method: "GET", path: basePath, signal: request.signal,
    }),
    create: (request) => wireRequest(normalizedServer, {
      credential: request.credential, method: "POST", operationId: request.operationId, path: basePath, signal: request.signal,
    }),
    withdraw: (request) => wireRequest(normalizedServer, {
      credential: request.credential, method: "POST", operationId: request.operationId, path: withdrawPath, signal: request.signal,
    }),
  }
}
