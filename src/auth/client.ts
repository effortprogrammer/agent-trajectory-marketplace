import ky, { isNetworkError, isTimeoutError } from "ky"
import type { ZodType } from "zod"

import {
  authChallengeResponseSchema,
  authErrorResponseSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
  authTokenResponseSchema,
} from "./contract"
import type {
  AuthAccessToken,
  AuthChallengeResponse,
  AuthLoginRequest,
  AuthLogoutResponse,
  AuthMeResponse,
  AuthSignupRequest,
  AuthTokenResponse,
  AuthVerificationRequest,
} from "./contract"
import { authEndpoint, normalizeAuthServerUrl } from "./server-url"

export const authClientErrorCodes = [
  "auth_request_failed",
  "auth_timeout",
  "auth_redirect_rejected",
  "invalid_auth_response",
  "unauthorized",
  "rate_limited",
  "account_required",
  "challenge_expired",
  "challenge_invalid",
] as const

export type AuthClientErrorCode = (typeof authClientErrorCodes)[number]

export class AuthClientError extends Error {
  readonly name = "AuthClientError"

  constructor(
    readonly code: AuthClientErrorCode,
    readonly status: number,
  ) {
    super(code)
  }
}

export type AuthClient = Readonly<{
  signup(request: AuthSignupRequest): Promise<AuthChallengeResponse>
  login(request: AuthLoginRequest): Promise<AuthChallengeResponse>
  verify(request: AuthVerificationRequest): Promise<AuthTokenResponse>
  status(accessToken: AuthAccessToken): Promise<AuthMeResponse>
  logout(accessToken: AuthAccessToken): Promise<AuthLogoutResponse>
}>

type AuthRequest<T> = Readonly<{
  accessToken?: AuthAccessToken
  body?: unknown
  endpoint: "signup" | "login" | "verify" | "me" | "logout"
  method: "GET" | "POST"
  schema: ZodType<T>
}>

const responseLimitBytes = 64 * 1024
const requestTimeoutMs = 10_000

const isBunTransportError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string"

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > responseLimitBytes) {
        await reader.cancel()
        throw new AuthClientError("invalid_auth_response", response.status)
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const parseJson = (body: Uint8Array, status: number): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new AuthClientError("invalid_auth_response", status)
  }
}

const mappedError = (status: number, body: unknown): AuthClientError => {
  const parsed = authErrorResponseSchema.safeParse(body)
  if (!parsed.success) return new AuthClientError("invalid_auth_response", status)
  if (parsed.data.error.code === "account_required") {
    return new AuthClientError("account_required", status)
  }
  if (parsed.data.error.code === "challenge_expired") {
    return new AuthClientError("challenge_expired", status)
  }
  if (parsed.data.error.code === "challenge_invalid") {
    return new AuthClientError("challenge_invalid", status)
  }
  if (status === 401) return new AuthClientError("unauthorized", status)
  if (status === 429) return new AuthClientError("rate_limited", status)
  return new AuthClientError("invalid_auth_response", status)
}

const perform = async <T>(serverUrl: string, request: AuthRequest<T>): Promise<T> => {
  const signal = AbortSignal.timeout(requestTimeoutMs)
  let response: Response
  try {
    response = await ky(authEndpoint(serverUrl, request.endpoint), {
      headers: {
        "content-type": "application/json",
        ...(request.accessToken === undefined
          ? {}
          : { authorization: `Bearer ${request.accessToken}` }),
      },
      method: request.method,
      redirect: "manual",
      retry: 0,
      signal,
      throwHttpErrors: false,
      timeout: requestTimeoutMs,
      ...(request.body === undefined ? {} : { json: request.body }),
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new AuthClientError("auth_redirect_rejected", response.status)
    }
    const body = parseJson(await readBoundedBody(response), response.status)
    if (!response.ok) throw mappedError(response.status, body)
    const parsed = request.schema.safeParse(body)
    if (!parsed.success) throw new AuthClientError("invalid_auth_response", response.status)
    return parsed.data
  } catch (error) {
    if (error instanceof AuthClientError) throw error
    if (isTimeoutError(error) || signal.aborted) {
      throw new AuthClientError("auth_timeout", 0)
    }
    if (
      isNetworkError(error) ||
      isBunTransportError(error) ||
      error instanceof TypeError ||
      error instanceof DOMException
    ) {
      throw new AuthClientError("auth_request_failed", 0)
    }
    throw error
  }
}

export function createAuthClient(serverUrl: unknown): AuthClient {
  const normalizedServerUrl = normalizeAuthServerUrl(serverUrl)
  return {
    signup: async (request) => perform(normalizedServerUrl, {
      body: request,
      endpoint: "signup",
      method: "POST",
      schema: authChallengeResponseSchema,
    }),
    login: async (request) => perform(normalizedServerUrl, {
      body: request,
      endpoint: "login",
      method: "POST",
      schema: authChallengeResponseSchema,
    }),
    verify: async (request) => perform(normalizedServerUrl, {
      body: request,
      endpoint: "verify",
      method: "POST",
      schema: authTokenResponseSchema,
    }),
    status: async (accessToken) => perform(normalizedServerUrl, {
      accessToken,
      endpoint: "me",
      method: "GET",
      schema: authMeResponseSchema,
    }),
    logout: async (accessToken) => perform(normalizedServerUrl, {
      accessToken,
      endpoint: "logout",
      method: "POST",
      schema: authLogoutResponseSchema,
    }),
  }
}
