import ky, { isNetworkError, isTimeoutError } from "ky"

import { createPublishFrameBody } from "./publish-frame"
import { parsePublishResponse } from "./publish-contract"
import type { PublishCandidate, PublishErrorCode, PublishReceipt } from "./publish-contract"

const responseLimitBytes = 64 * 1024
const publishTimeoutMs = 15 * 60 * 1000
const publishPath = "/v1/marketplace/seller/candidates"

type PublishClientErrorCode =
  | PublishErrorCode
  | "invalid_response"
  | "redirect_rejected"
  | "request_failed"
  | "timeout"
  | "unexpected_response"

export class PublishClientError extends Error {
  readonly name = "PublishClientError"
  constructor(readonly code: PublishClientErrorCode, readonly status: number) { super(code) }
}

type PublishRequest = Readonly<{ readonly archive: Uint8Array; readonly candidate: PublishCandidate; readonly credential: string }>
export type PublishClient = Readonly<{ publish(request: PublishRequest): Promise<PublishReceipt> }>

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

export const createPublishClient = (server: string): PublishClient => ({
  publish: async (request): Promise<PublishReceipt> => {
    const signal = AbortSignal.timeout(publishTimeoutMs)
    try {
      const frame = createPublishFrameBody(request.candidate, request.archive)
      const response = await ky(`${server}${publishPath}`, {
        body: frame.body,
        headers: {
          authorization: `Bearer ${request.credential}`,
          "content-length": String(frame.contentLength),
          "content-type": "application/octet-stream",
          "idempotency-key": `archive-${request.candidate.archiveSha256}`,
        },
        method: "POST", redirect: "manual", retry: 0, signal, throwHttpErrors: false, timeout: publishTimeoutMs,
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel()
        throw new PublishClientError("redirect_rejected", response.status)
      }
      const parsed = parsePublishResponse(response.status, await boundedBody(response))
      if ("code" in parsed) throw new PublishClientError(parsed.code, response.status)
      if (!("statusUrl" in parsed) || parsed.status !== "accepted") {
        throw new PublishClientError("unexpected_response", response.status)
      }
      return parsed
    } catch (error) {
      if (error instanceof PublishClientError) throw error
      if (isTimeoutError(error) || signal.aborted) throw new PublishClientError("timeout", 0)
      if (isNetworkError(error) || error instanceof TypeError || error instanceof DOMException) throw new PublishClientError("request_failed", 0)
      throw new PublishClientError("invalid_response", 0)
    }
  },
})
