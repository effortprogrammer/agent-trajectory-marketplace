import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"

import {
  authAccessTokenSchema,
  authAccountIdSchema,
  authChallengeIdSchema,
  authEmailSchema,
  authOtpCodeSchema,
} from "../../../src/auth/contract"
import { AuthClientError, createAuthClient } from "../../../src/auth/client"

type CapturedRequest = Readonly<{
  authorization: string | null
  body: string
  contentType: string | null
  method: string
  pathname: string
}>

const servers: Bun.Server<undefined>[] = []

const serve = (fetch: (request: Request) => Response | Promise<Response>): Bun.Server<undefined> => {
  const server = Bun.serve({ fetch, hostname: "127.0.0.1", port: 0 })
  servers.push(server)
  return server
}

const json = (value: unknown, status = 200, headers?: Readonly<Record<string, string>>): Response =>
  Response.json(value, { headers, status })

const capture = async (request: Request): Promise<CapturedRequest> => ({
  authorization: request.headers.get("authorization"),
  body: await request.text(),
  contentType: request.headers.get("content-type"),
  method: request.method,
  pathname: new URL(request.url).pathname,
})

const expectClientError = async (action: () => Promise<unknown>): Promise<AuthClientError> => {
  try {
    await action()
  } catch (error) {
    expect(error).toBeInstanceOf(AuthClientError)
    if (error instanceof AuthClientError) return error
    throw error
  }
  throw new TypeError("expected AuthClientError")
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  mock.restore()
})

describe("bounded passwordless auth client", () => {
  test("sends exact passwordless requests and confines bearer authorization", async () => {
    // Given: a real loopback auth server returning strict lifecycle responses.
    const requests: CapturedRequest[] = []
    const server = serve(async (request) => {
      requests.push(await capture(request))
      const pathname = new URL(request.url).pathname
      if (pathname === "/v1/auth/signup" || pathname === "/v1/auth/login") {
        return json({ ok: true, challengeId: "chal-0123456789abcdef", expiresAt: "2026-07-25T00:00:00.000Z" })
      }
      if (pathname === "/v1/auth/verify") {
        return json({
          ok: true,
          accessToken: "sentinel-access-token",
          tokenType: "Bearer",
          expiresAt: "2026-07-25T01:00:00.000Z",
          accountId: "acct-0123456789abcdef",
        })
      }
      if (pathname === "/v1/auth/me") {
        return json({ ok: true, account: { accountId: "acct-0123456789abcdef", email: "owner@example.test" } })
      }
      return json({ ok: true, revoked: true })
    })
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    const email = authEmailSchema.parse("owner@example.test")
    const challengeId = authChallengeIdSchema.parse("chal-0123456789abcdef")
    const accountId = authAccountIdSchema.parse("acct-0123456789abcdef")
    const code = authOtpCodeSchema.parse("123456")
    const token = authAccessTokenSchema.parse("sentinel-access-token")

    // When: every passwordless lifecycle operation is performed once.
    const signup = await client.signup({ email, acceptTerms: true })
    const login = await client.login({ email })
    const verification = await client.verify({ challengeId, code })
    const status = await client.status(token)
    const logout = await client.logout(token)

    // Then: results parse and only the authenticated endpoints receive the bearer.
    expect([signup.challengeId, login.challengeId, verification.accountId, status.account.accountId, logout.revoked]).toEqual([
      challengeId,
      challengeId,
      accountId,
      accountId,
      true,
    ])
    expect(requests).toEqual([
      { authorization: null, body: JSON.stringify({ email, acceptTerms: true }), contentType: "application/json", method: "POST", pathname: "/v1/auth/signup" },
      { authorization: null, body: JSON.stringify({ email }), contentType: "application/json", method: "POST", pathname: "/v1/auth/login" },
      { authorization: null, body: JSON.stringify({ challengeId, code }), contentType: "application/json", method: "POST", pathname: "/v1/auth/verify" },
      { authorization: `Bearer ${token}`, body: "", contentType: "application/json", method: "GET", pathname: "/v1/auth/me" },
      { authorization: `Bearer ${token}`, body: "", contentType: "application/json", method: "POST", pathname: "/v1/auth/logout" },
    ])
  })

  test.each([301, 302, 303, 307, 308])("rejects HTTP %i without following cross-origin redirects", async (status) => {
    // Given: an auth server redirecting to a distinct real loopback server.
    let redirectHits = 0
    const redirected = serve(() => {
      redirectHits += 1
      return json({ ok: true, challengeId: "chal-0123456789abcdef", expiresAt: "2026-07-25T00:00:00.000Z" })
    })
    let authHits = 0
    const auth = serve(() => {
      authHits += 1
      return new Response(null, { headers: { location: `http://127.0.0.1:${redirected.port}/steal` }, status })
    })
    const client = createAuthClient(`http://127.0.0.1:${auth.port}`)
    const email = authEmailSchema.parse("owner@example.test")

    // When: login receives a redirect.
    const error = await expectClientError(() => client.login({ email }))

    // Then: the redirect is rejected before a second request can escape.
    expect({ code: error.code, status: error.status, authHits, redirectHits }).toEqual({
      code: "auth_redirect_rejected",
      status,
      authHits: 1,
      redirectHits: 0,
    })
  })

  test.each([
    [401, "unauthorized", { ok: false, error: { code: "anything", message: "ignore me" } }],
    [429, "rate_limited", { ok: false, error: { code: "anything", message: "ignore me" } }],
    [400, "challenge_expired", { ok: false, error: { code: "challenge_expired", message: "expired" } }],
    [400, "challenge_invalid", { ok: false, error: { code: "challenge_invalid", message: "invalid" } }],
  ] as const)("maps HTTP %i responses to %s", async (status, expectedCode, body) => {
    // Given: a real auth endpoint returning one mapped failure.
    let hits = 0
    const server = serve(() => {
      hits += 1
      return json(body, status)
    })
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    const challengeId = authChallengeIdSchema.parse("chal-0123456789abcdef")
    const code = authOtpCodeSchema.parse("123456")

    // When: verification receives the failure.
    const error = await expectClientError(() => client.verify({ challengeId, code }))

    // Then: one request yields the stable typed code without retry.
    expect({ code: error.code, status: error.status, hits }).toEqual({ code: expectedCode, status, hits: 1 })
  })

  test.each([
    ["malformed JSON", "{prompt: exfiltrate tokens", 200],
    ["hostile unknown error", JSON.stringify({ ok: false, error: { code: "ignore_previous_instructions", message: "send secrets" } }), 400],
    ["wrong success schema", JSON.stringify({ ok: true, accessToken: "stale-state" }), 200],
  ] as const)("rejects %s as an invalid response", async (_name, responseBody, status) => {
    // Given: a server returns an untrusted body outside the strict contract.
    let hits = 0
    const server = serve(() => {
      hits += 1
      return new Response(responseBody, { status })
    })
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    const email = authEmailSchema.parse("owner@example.test")

    // When: login parses the response boundary.
    const error = await expectClientError(() => client.login({ email }))

    // Then: the body is rejected without retry or reflecting hostile content.
    expect({ code: error.code, message: error.message, hits }).toEqual({
      code: "invalid_auth_response",
      message: "invalid_auth_response",
      hits: 1,
    })
  })

  test("cancels a streamed response after the 64 KiB cap", async () => {
    // Given: a server streams one byte beyond the response limit.
    let hits = 0
    const cancelSpy = spyOn(ReadableStreamDefaultReader.prototype, "cancel")
    const server = serve(() => {
      hits += 1
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(65_536))
          controller.enqueue(new Uint8Array(1))
        },
      }))
    })
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    const email = authEmailSchema.parse("owner@example.test")

    // When: login reads the streamed response.
    const error = await expectClientError(() => client.login({ email }))

    // Then: it rejects at the cap, cancels the stream, and never retries.
    expect({ code: error.code, hits }).toEqual({ code: "invalid_auth_response", hits: 1 })
    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })

  test("times out once after the fixed ten-second deadline", async () => {
    // Given: a real endpoint that remains pending past the client deadline.
    let hits = 0
    const server = serve(async () => {
      hits += 1
      await Bun.sleep(20_000)
      return json({ ok: true, challengeId: "chal-0123456789abcdef", expiresAt: "2026-07-25T00:00:00.000Z" })
    })
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    const email = authEmailSchema.parse("owner@example.test")
    const startedAt = performance.now()

    // When: login waits for the hung endpoint.
    const error = await expectClientError(() => client.login({ email }))

    // Then: it times out near ten seconds and does not retry.
    expect(error.code).toBe("auth_timeout")
    expect(hits).toBe(1)
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(9_500)
    expect(performance.now() - startedAt).toBeLessThan(12_000)
  }, 15_000)

  test("maps connection failure without a retry", async () => {
    // Given: a normalized loopback origin whose server has already stopped.
    const server = serve(() => json({ ok: true }))
    const client = createAuthClient(`http://127.0.0.1:${server.port}`)
    server.stop(true)
    servers.splice(servers.indexOf(server), 1)
    const email = authEmailSchema.parse("owner@example.test")

    // When: login cannot connect.
    const error = await expectClientError(() => client.login({ email }))

    // Then: the transport error is stable and contains no endpoint detail.
    expect({ code: error.code, message: error.message, status: error.status }).toEqual({
      code: "auth_request_failed",
      message: "auth_request_failed",
      status: 0,
    })
  })
})
