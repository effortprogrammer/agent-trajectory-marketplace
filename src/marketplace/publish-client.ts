import ky, { isNetworkError, isTimeoutError } from "ky"

import { normalizeAuthServerUrl } from "../auth/server-url"
import type { PublishBundle } from "./publish-bundle"
import { createPublishFrameBody } from "./publish-frame"
import { PublishWireContractError, parsePublishResponse } from "./publish-contract"
import type { PublishErrorCode, PublishReceipt } from "./publish-contract"

const responseLimitBytes = 64 * 1024
const publishTimeoutMs = 15 * 60 * 1000
const publishPath = "/v1/marketplace/seller/candidates"

type PublishClientErrorCode =
  | PublishErrorCode
  | "cancelled"
  | "invalid_response"
  | "missing_publish_credential"
  | "redirect_rejected"
  | "request_failed"
  | "timeout"
  | "unexpected_response"

export class PublishClientError extends Error {
  readonly name = "PublishClientError"
  constructor(readonly code: PublishClientErrorCode, readonly status: number) { super(code) }
}

type PublishRequest = Readonly<{
  readonly bundle: PublishBundle
  readonly credential: string
  readonly signal?: AbortSignal
}>
export type PublishClient = Readonly<{ publish(request: PublishRequest): Promise<PublishReceipt> }>

export const validPublishCredential = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u0020\u007f]/u.test(value)

const assertDeclaredResponseLength = async (response: Response): Promise<void> => {
  const declared = response.headers.get("content-length")
  if (declared === null) return
  const length = /^(0|[1-9]\d*)$/u.test(declared) ? Number(declared) : Number.NaN
  if (!Number.isSafeInteger(length) || length > responseLimitBytes) {
    await response.body?.cancel()
    throw new PublishClientError("invalid_response", response.status)
  }
}

const boundedBody = async (response: Response): Promise<Uint8Array> => {
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
        throw new PublishClientError("invalid_response", response.status)
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length)
}

export const createPublishClient = (serverInput: unknown): PublishClient => {
  const server = normalizeAuthServerUrl(serverInput)
  return {
    publish: async (request): Promise<PublishReceipt> => {
      if (!validPublishCredential(request.credential)) {
        throw new PublishClientError("missing_publish_credential", 0)
      }
      const callerAborted = (): boolean => request.signal?.aborted === true
      if (callerAborted()) throw new PublishClientError("cancelled", 0)
      const timeoutSignal = AbortSignal.timeout(publishTimeoutMs)
      const signal = request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal])
      let responseStatus = 0
      try {
        const archiveSha256 = request.bundle.candidate.archiveSha256
        const frame = createPublishFrameBody(request.bundle)
        const response = await ky(`${server}${publishPath}`, {
          body: frame.body,
          headers: {
            authorization: `Bearer ${request.credential}`,
            "content-length": String(frame.contentLength),
            "content-type": "application/octet-stream",
            "idempotency-key": `archive-${archiveSha256}`,
          },
          method: "POST", redirect: "manual", retry: 0, signal, throwHttpErrors: false, timeout: publishTimeoutMs,
        })
        responseStatus = response.status
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel()
          throw new PublishClientError("redirect_rejected", response.status)
        }
        await assertDeclaredResponseLength(response)
        const parsed = parsePublishResponse(response.status, await boundedBody(response))
        if ("code" in parsed) throw new PublishClientError(parsed.code, response.status)
        if (!("statusUrl" in parsed) || parsed.status !== "accepted") {
          throw new PublishClientError("unexpected_response", response.status)
        }
        return parsed
      } catch (error) {
        if (error instanceof PublishClientError) throw error
        if (error instanceof PublishWireContractError) throw new PublishClientError(error.code, responseStatus)
        if (callerAborted()) throw new PublishClientError("cancelled", 0)
        if (isTimeoutError(error) || timeoutSignal.aborted) throw new PublishClientError("timeout", 0)
        if (isNetworkError(error) || error instanceof TypeError || error instanceof DOMException) throw new PublishClientError("request_failed", 0)
        throw new PublishClientError("invalid_response", 0)
      }
    },
  }
}
