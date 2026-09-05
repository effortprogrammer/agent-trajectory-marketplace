import {
  accessToken,
  accountId,
  challengeId,
  eligiblePayout,
  expiresAt,
  legacySellerSessions,
  sellerEarnings,
  sellerSessions,
  signupChallengeId,
} from "./session-marketplace-registry-data.fixture"

export type RegistryRequest = Readonly<{
  authorization: string | null
  body: unknown
  idempotencyKey?: string
  method: string
  path: string
}>

export type PayoutFixture = Readonly<{
  body: unknown
  retryAfter?: string
  status: number
}>

export type SessionRegistry = Readonly<{
  holdChallenge: () => () => void
  holdPayout: () => () => void
  holdVerify: () => () => void
  requests: RegistryRequest[]
  server: Bun.Server<undefined>
  setLogoutStatus: (status: number) => void
  setPayoutResponses: (...responses: PayoutFixture[]) => void
  setPublicPayoutCapacity: (value: unknown) => void
  setPublicTokenTotal: (value: number | string) => void
  setVerifyAccountRequired: () => void
  url: string
}>

const json = (
  body: unknown,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response => Response.json(body, {
  headers: {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    ...extraHeaders,
  },
  status,
})

const parseBody = async (request: Request): Promise<unknown> => {
  if (request.method === "GET") return undefined
  return request.json()
}

export const startSessionRegistry = (): SessionRegistry => {
  const requests: RegistryRequest[] = []
  let logoutStatus = 200
  let publicTokenTotal: number | string = "39048328"
  let publicPayoutCapacity: unknown = {
    ok: true,
    payoutCapacity: {
      currency: "USD",
      limitMinor: 30_000,
      payoutRemainingMinor: 18_000,
      scope: "platform",
      windowSeconds: 604_800,
    },
  }
  let verifyAccountRequired = false
  let challengeGate: Promise<void> | undefined
  let challengeRelease: (() => void) | undefined
  let payoutGate: Promise<void> | undefined
  let payoutRelease: (() => void) | undefined
  let payoutResponses: PayoutFixture[] = [{ body: eligiblePayout, status: 200 }]
  let verifyGate: Promise<void> | undefined
  let verifyRelease: (() => void) | undefined
  const server = Bun.serve({
    async fetch(request) {
      const url = new URL(request.url)
      const body = await parseBody(request)
      const idempotencyKey = request.headers.get("idempotency-key")
      requests.push({
        authorization: request.headers.get("authorization"),
        body,
        ...(idempotencyKey === null ? {} : { idempotencyKey }),
        method: request.method,
        path: `${url.pathname}${url.search}`,
      })
      if (request.method === "OPTIONS") return json({}, 204)
      if (url.pathname === "/v1/auth/signup" || url.pathname === "/v1/auth/login") {
        if (challengeGate !== undefined) await challengeGate
        return json({
          challengeId:
            url.pathname === "/v1/auth/signup" ? signupChallengeId : challengeId,
          expiresAt,
          ok: true,
        })
      }
      if (url.pathname === "/v1/auth/verify") {
        if (verifyGate !== undefined) await verifyGate
        if (verifyAccountRequired) {
          return json({
            error: {
              code: "account_required",
              message: "no member account exists for this email",
            },
            ok: false,
          }, 401)
        }
        return json({
          accessToken,
          accountId,
          expiresAt,
          ok: true,
          tokenType: "Bearer",
        })
      }
      const authorized =
        request.headers.get("authorization") === `Bearer ${accessToken}`
      if (url.pathname === "/v1/auth/me") {
        return authorized
          ? json({ account: { accountId, email: "owner@example.test" }, ok: true })
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      if (url.pathname === "/v2/marketplace/seller/sales/sessions") {
        return authorized
          ? json(sellerSessions)
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      if (url.pathname === "/v1/marketplace/seller/sales/sessions") {
        return authorized
          ? json(legacySellerSessions)
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      if (url.pathname === "/v1/marketplace/seller/sales/earnings") {
        return authorized
          ? json(sellerEarnings)
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      if (url.pathname === "/v1/marketplace/seller/weekly-limits") {
        return authorized
          ? json({
            ok: true,
            weeklyLimits: {
              scope: "platform",
              currency: "USD",
              limitMinor: 30_000,
              payoutRemainingMinor: 18_000,
              sessionValueRemainingMinor: 7_500,
              windowSeconds: 604_800,
            },
          })
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      if (
        url.pathname === "/v1/marketplace/seller/payout-request"
        || url.pathname === "/v1/marketplace/seller/payout-request/withdraw"
      ) {
        if (!authorized) {
          return json({
            error: {
              code: "unauthorized",
              message: "Authentication is required.",
            },
            ok: false,
          }, 401)
        }
        if (payoutGate !== undefined) await payoutGate
        const fixture = payoutResponses.length > 1
          ? payoutResponses.shift()
          : payoutResponses[0]
        if (fixture === undefined) throw new Error("payout fixture queue is empty")
        return json(
          fixture.body,
          fixture.status,
          fixture.retryAfter === undefined
            ? {}
            : { "retry-after": fixture.retryAfter },
        )
      }
      if (url.pathname === "/v1/auth/logout") {
        return logoutStatus === 200
          ? json({ ok: true, revoked: true })
          : json({ error: { code: "unavailable" }, ok: false }, logoutStatus)
      }
      if (url.pathname === "/v1/marketplace/public-stats") {
        return json({ tradeableTokens: publicTokenTotal })
      }
      if (url.pathname === "/v1/marketplace/public-payout-capacity") {
        return json(publicPayoutCapacity)
      }
      if (url.pathname === "/v1/marketplace/stats") {
        return authorized
          ? json({
            activeRuntimes: 1,
            paidOutCredits: null,
            totalSessions: 2,
            tradeableTokens: 940_635,
          })
          : json({ error: { code: "unauthorized" }, ok: false }, 401)
      }
      return json({ error: "not_found" }, 404)
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  if (server.port === undefined) throw new Error("Registry fixture omitted its port")

  return {
    requests,
    holdChallenge: () => {
      if (challengeGate !== undefined) throw new Error("challenge request is already held")
      challengeGate = new Promise((resolve) => {
        challengeRelease = resolve
      })
      return () => {
        const release = challengeRelease
        challengeGate = undefined
        challengeRelease = undefined
        release?.()
      }
    },
    holdPayout: () => {
      if (payoutGate !== undefined) throw new Error("payout request is already held")
      payoutGate = new Promise((resolve) => {
        payoutRelease = resolve
      })
      return () => {
        const release = payoutRelease
        payoutGate = undefined
        payoutRelease = undefined
        release?.()
      }
    },
    holdVerify: () => {
      if (verifyGate !== undefined) throw new Error("verify request is already held")
      verifyGate = new Promise((resolve) => {
        verifyRelease = resolve
      })
      return () => {
        const release = verifyRelease
        verifyGate = undefined
        verifyRelease = undefined
        release?.()
      }
    },
    server,
    setLogoutStatus: (status) => {
      logoutStatus = status
    },
    setPayoutResponses: (...responses) => {
      if (responses.length === 0) {
        throw new Error("at least one payout fixture is required")
      }
      payoutResponses = [...responses]
    },
    setPublicPayoutCapacity: (value) => {
      publicPayoutCapacity = value
    },
    setPublicTokenTotal: (value) => {
      publicTokenTotal = value
    },
    setVerifyAccountRequired: () => {
      verifyAccountRequired = true
    },
    url: `http://127.0.0.1:${server.port}`,
  }
}
