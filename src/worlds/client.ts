import ky, { isNetworkError, isTimeoutError } from "ky"

import { normalizeAuthServerUrl } from "../auth/server-url"
import {
  WorldContractError,
  parseWorldResponse,
} from "./contracts"
import type {
  WorldCatalogDetailResponse,
  WorldCatalogListResponse,
  WorldDeliveryGrant,
  WorldDeliveryScope,
  WorldEndpoint,
  WorldHostedCreateBody,
  WorldHostedRuntimeResponse,
  WorldResponse,
} from "./contracts"

const responseLimitBytes = 64 * 1024
const requestTimeoutMs = 10_000

const worldClientErrorCodes = [
  "cancelled", "conflict", "incompatible", "invalid_request", "invalid_response",
  "missing_access_token", "not_found", "quota_exceeded", "redirect_rejected",
  "request_failed", "revoked", "runtime_rejected", "timeout", "unauthorized",
] as const
type WorldClientErrorCode = (typeof worldClientErrorCodes)[number]

export class WorldClientError extends Error {
  readonly name = "WorldClientError"
  constructor(readonly code: WorldClientErrorCode, readonly status: number) { super(code) }
}

export type WorldIssueEntitlementRequest = Readonly<{
  accessToken: string
  contractId: string
  requestedScope: WorldDeliveryScope
  idempotencyKey: string
}>
export type WorldRedeemDownloadRequest = Readonly<{ accessToken: string; entitlementId: string }>
export type WorldCreateHostedInstanceRequest = Readonly<{
  accessToken: string
  contractId: string
  packDigest: string
  idempotencyKey: string
  body: WorldHostedCreateBody
}>
export type WorldHostedStatusRequest = Readonly<{
  accessToken: string
  contractId: string
  packDigest: string
  instanceId: string
}>
export type WorldClient = Readonly<{
  catalog(): Promise<WorldCatalogListResponse>
  world(request: Readonly<{ worldId: string }>): Promise<WorldCatalogDetailResponse>
  issueEntitlement(request: WorldIssueEntitlementRequest): Promise<WorldDeliveryGrant>
  redeemDownload(request: WorldRedeemDownloadRequest): Promise<WorldDeliveryGrant>
  createHostedInstance(request: WorldCreateHostedInstanceRequest): Promise<WorldHostedRuntimeResponse>
  hostedStatus(request: WorldHostedStatusRequest): Promise<WorldHostedRuntimeResponse>
}>

const nonemptyText = (value: string): boolean => value.length > 0 && value.trim() === value && !/[\u0000-\u0020\u007f]/.test(value)
const digest = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)
const routeId = (value: string): boolean => nonemptyText(value) && value.length <= 512
const contentIsJson = (value: string | null): boolean => value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
const isTransportError = (error: unknown): boolean => error instanceof Error && "code" in error && typeof error.code === "string"

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
  const length = response.headers.get("content-length")
  if (length !== null && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > responseLimitBytes)) {
    await response.body?.cancel()
    throw new WorldClientError("invalid_response", response.status)
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > responseLimitBytes) {
        await reader.cancel()
        throw new WorldClientError("invalid_response", response.status)
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const encodeWorldPath = (worldId: string): string => worldId.split("/").map(encodeURIComponent).join("/")
const hostedRoot = (contractId: string): string => `/v1/marketplace/buyer/world-contracts/${encodeURIComponent(contractId)}/hosted/instances`

const clientError = (response: WorldResponse, status: number): WorldClientError => {
  if (status === 401) return new WorldClientError("unauthorized", status)
  if (status === 410) return new WorldClientError("revoked", status)
  if (status === 422) return new WorldClientError("incompatible", status)
  if (status === 404) return new WorldClientError("not_found", status)
  if (status === 409) return new WorldClientError("conflict", status)
  if (status === 400) return new WorldClientError("invalid_request", status)
  if (status === 429) return new WorldClientError("quota_exceeded", status)
  if ("ok" in response && !response.ok && response.error.code === "runtime_rejected") {
    return new WorldClientError("runtime_rejected", status)
  }
  return new WorldClientError("invalid_response", status)
}

const hasCatalog = (response: WorldResponse): response is WorldCatalogListResponse => "worlds" in response
const hasWorld = (response: WorldResponse): response is WorldCatalogDetailResponse => "conformance" in response
const hasGrant = (response: WorldResponse): response is WorldDeliveryGrant => "entitlementId" in response
const hasHostedResult = (response: WorldResponse): response is WorldHostedRuntimeResponse =>
  "ok" in response && response.ok

export const createWorldClient = (server: unknown, callerSignal?: AbortSignal): WorldClient => {
  const normalizedServer = normalizeAuthServerUrl(server)
  const request = async (
    endpoint: WorldEndpoint,
    path: string,
    method: "GET" | "POST",
    credential?: string,
    body?: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
  ): Promise<Readonly<{ response: WorldResponse; status: number }>> => {
    if (callerSignal?.aborted) throw new WorldClientError("cancelled", 0)
    if (credential !== undefined && !nonemptyText(credential)) throw new WorldClientError("missing_access_token", 0)
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
    const signal = callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal])
    let status = 0
    try {
      const response = await ky(`${normalizedServer}${path}`, {
        headers: {
          ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
          ...(headers ?? {}),
        },
        method, redirect: "manual", retry: 0, signal, throwHttpErrors: false, timeout: requestTimeoutMs,
        ...(body === undefined ? {} : { json: body }),
      })
      status = response.status
      if (status >= 300 && status < 400) {
        await response.body?.cancel()
        throw new WorldClientError("redirect_rejected", status)
      }
      const bytes = await readBoundedBody(response)
      if (bytes.byteLength > 0 && !contentIsJson(response.headers.get("content-type"))) {
        throw new WorldClientError("invalid_response", status)
      }
      return { response: parseWorldResponse(endpoint, status, bytes), status }
    } catch (error) {
      if (callerSignal?.aborted) throw new WorldClientError("cancelled", 0)
      if (error instanceof WorldClientError) throw error
      if (error instanceof WorldContractError) throw new WorldClientError("invalid_response", status)
      if (isTimeoutError(error) || timeoutSignal.aborted) throw new WorldClientError("timeout", 0)
      if (isNetworkError(error) || isTransportError(error) || error instanceof TypeError || error instanceof DOMException) {
        throw new WorldClientError("request_failed", 0)
      }
      throw new WorldClientError("invalid_response", status)
    }
  }

  return {
    catalog: async (): Promise<WorldCatalogListResponse> => {
      const { response } = await request("catalog", "/v1/marketplace/worlds", "GET")
      if (hasCatalog(response)) return response
      throw clientError(response, 200)
    },
    world: async ({ worldId }): Promise<WorldCatalogDetailResponse> => {
      if (!routeId(worldId)) throw new WorldClientError("invalid_request", 0)
      const { response, status } = await request("world", `/v1/marketplace/worlds/${encodeWorldPath(worldId)}`, "GET")
      if (hasWorld(response)) return response
      throw clientError(response, status)
    },
    issueEntitlement: async ({ accessToken, contractId, requestedScope, idempotencyKey }): Promise<WorldDeliveryGrant> => {
      if (!routeId(contractId) || !nonemptyText(idempotencyKey) || idempotencyKey.length > 128) throw new WorldClientError("invalid_request", 0)
      const { response, status } = await request("issue_entitlement", "/v1/marketplace/buyer/world-entitlements", "POST", accessToken, {
        contractId, requestedScope, idempotencyKey,
      })
      if (hasGrant(response)) return response
      throw clientError(response, status)
    },
    redeemDownload: async ({ accessToken, entitlementId }): Promise<WorldDeliveryGrant> => {
      if (!routeId(entitlementId)) throw new WorldClientError("invalid_request", 0)
      const { response, status } = await request("redeem_download", `/v1/marketplace/buyer/world-entitlements/${encodeURIComponent(entitlementId)}/downloads`, "POST", accessToken)
      if (hasGrant(response)) return response
      throw clientError(response, status)
    },
    createHostedInstance: async ({ accessToken, contractId, packDigest, idempotencyKey, body }): Promise<WorldHostedRuntimeResponse> => {
      if (!routeId(contractId) || !digest(packDigest) || !nonemptyText(idempotencyKey) || idempotencyKey.length > 128 || !isObject(body)) throw new WorldClientError("invalid_request", 0)
      const { response, status } = await request("hosted_create", hostedRoot(contractId), "POST", accessToken, body, {
        "idempotency-key": idempotencyKey, "x-world-pack-digest": packDigest,
      })
      if (hasHostedResult(response)) return response
      throw clientError(response, status)
    },
    hostedStatus: async ({ accessToken, contractId, packDigest, instanceId }): Promise<WorldHostedRuntimeResponse> => {
      if (!routeId(contractId) || !routeId(instanceId) || !digest(packDigest)) throw new WorldClientError("invalid_request", 0)
      const { response, status } = await request("hosted_status", `${hostedRoot(contractId)}/${encodeURIComponent(instanceId)}`, "GET", accessToken, undefined, {
        "x-world-pack-digest": packDigest,
      })
      if (hasHostedResult(response)) return response
      throw clientError(response, status)
    },
  }
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
