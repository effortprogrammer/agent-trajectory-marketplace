import { resolve } from "node:path"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type ViewportSize,
} from "playwright"

const publicRoot = resolve(import.meta.dir, "../../..")
const accessToken = "marketplace-browser-session-token"
const accountId = "acct-0123456789abcdef"
const challengeId = "chal-0123456789abcdef"
const expiresAt = "2030-01-01T00:00:00.000Z"
const sellerSessions = {
  asOf: "2026-08-20T12:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    askCredits: 125,
    datasetId: "seller-dataset-alpha",
    earnedCredits: 100,
    listedAt: "2026-08-19T10:00:00Z",
    saleStatus: { changedAt: "2026-08-20T11:30:00Z", exception: null, listingCycleId: "22222222-2222-4222-8222-222222222222", stage: "sold" },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: "2026-08-20T11:30:00Z",
  }],
}
const sellerEarnings = {
  asOf: "2026-08-20T12:00:00Z", currency: "USD", interval: "day", ok: true, openingCumulativeCredits: 0,
  points: [{ cumulativeNetCredits: 0, periodStart: "2026-08-19T00:00:00Z" }, { cumulativeNetCredits: 100, periodStart: "2026-08-20T00:00:00Z" }],
  window: { from: "2026-07-21", to: "2026-08-20" },
}
let sharedBrowser: Browser | undefined

export type RegistryRequest = Readonly<{
  authorization: string | null
  body: unknown
  method: string
  path: string
}>

export interface SessionUiHarness {
  readonly appUrl: string
  readonly holdVerify: () => () => void
  readonly registryRequests: RegistryRequest[]
  readonly setLogoutStatus: (status: number) => void
  readonly setPublicTokenTotal: (value: number | string) => void
  readonly newPage: (
    viewport: ViewportSize,
    options?: Pick<BrowserContextOptions, "javaScriptEnabled" | "permissions">,
  ) => Promise<Page>
  readonly close: () => Promise<void>
}

const reservePort = (): number => {
  const probe = Bun.serve({ fetch: () => new Response("reserved"), port: 0 })
  const port = probe.port
  probe.stop(true)
  if (port === undefined) throw new Error("port-zero server omitted port")
  return port
}

const waitForReadyOutput = async (
  stream: ReadableStream<Uint8Array>,
  expected: string,
): Promise<void> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`web server did not print ${expected}`)), 5_000)
  })
  try {
    while (!output.includes(expected)) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) throw new Error(`web server exited before printing ${expected}`)
      output += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    reader.releaseLock()
  }
}

const json = (body: unknown, status = 200): Response => Response.json(body, {
  headers: {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  },
  status,
})

const parseBody = async (request: Request): Promise<unknown> => {
  if (request.method === "GET") return undefined
  return request.json()
}

const startRegistry = () => {
  const requests: RegistryRequest[] = []
  let logoutStatus = 200
  let publicTokenTotal: number | string = "39048328"
  let verifyGate: Promise<void> | undefined
  let verifyRelease: (() => void) | undefined
  const server = Bun.serve({
    async fetch(request) {
      const url = new URL(request.url)
      const body = await parseBody(request)
      requests.push({
        authorization: request.headers.get("authorization"),
        body,
        method: request.method,
        path: `${url.pathname}${url.search}`,
      })
      if (request.method === "OPTIONS") return json({}, 204)
      if (url.pathname === "/v1/auth/signup" || url.pathname === "/v1/auth/login") {
        return json({ challengeId, expiresAt, ok: true })
      }
      if (url.pathname === "/v1/auth/verify") {
        if (verifyGate !== undefined) await verifyGate
        return json({ accessToken, accountId, expiresAt, ok: true, tokenType: "Bearer" })
      }
      if (url.pathname === "/v1/auth/me") {
        if (request.headers.get("authorization") !== `Bearer ${accessToken}`) return json({ error: { code: "unauthorized" }, ok: false }, 401)
        return json({ account: { accountId, email: "owner@example.test" }, ok: true })
      }
      if (url.pathname === "/v1/marketplace/seller/sales/sessions") {
        if (request.headers.get("authorization") !== `Bearer ${accessToken}`) return json({ error: { code: "unauthorized" }, ok: false }, 401)
        return json(sellerSessions)
      }
      if (url.pathname === "/v1/marketplace/seller/sales/earnings") {
        if (request.headers.get("authorization") !== `Bearer ${accessToken}`) return json({ error: { code: "unauthorized" }, ok: false }, 401)
        return json(sellerEarnings)
      }
      if (url.pathname === "/v1/auth/logout") {
        return logoutStatus === 200
          ? json({ ok: true, revoked: true })
          : json({ error: { code: "unavailable" }, ok: false }, logoutStatus)
      }
      if (url.pathname === "/v1/marketplace/public-stats") {
        return json({ tradeableTokens: publicTokenTotal })
      }
      if (url.pathname === "/v1/marketplace/stats") {
        if (request.headers.get("authorization") !== `Bearer ${accessToken}`) {
          return json({ error: { code: "unauthorized" }, ok: false }, 401)
        }
        return json({
          activeRuntimes: 1,
          paidOutCredits: null,
          totalSessions: 2,
          tradeableTokens: 940_635,
        })
      }
      return json({ error: "not_found" }, 404)
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  return {
    requests,
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
    setLogoutStatus: (status: number) => {
      logoutStatus = status
    },
    setPublicTokenTotal: (value: number | string) => {
      publicTokenTotal = value
    },
    url: `http://127.0.0.1:${server.port}`,
  }
}

export const startSessionUiHarness = async (): Promise<SessionUiHarness> => {
  const registry = startRegistry()
  const port = reservePort()
  const web = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_PUBLIC_STATS_URL: `${registry.url}/v1/marketplace/public-stats`,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  const contexts: BrowserContext[] = []
  try {
    await waitForReadyOutput(web.stdout, `marketplace ui: http://localhost:${port}/`)
    sharedBrowser ??= await chromium.launch({
      args: ["--disable-background-networking"],
      headless: true,
    })
  } catch (error) {
    web.kill()
    await web.exited
    registry.server.stop(true)
    throw error
  }

  const browser = sharedBrowser
  if (browser === undefined) throw new Error("Playwright Chromium did not launch")
  return {
    appUrl: `http://127.0.0.1:${port}`,
    holdVerify: registry.holdVerify,
    registryRequests: registry.requests,
    setLogoutStatus: registry.setLogoutStatus,
    setPublicTokenTotal: registry.setPublicTokenTotal,
    newPage: async (viewport, options = {}) => {
      const context = await browser.newContext({
        ...options,
        reducedMotion: "reduce",
        viewport,
      })
      await context.route("https://gateway.getatm.io/**", async (route) => {
        const requested = new URL(route.request().url())
        const response = await route.fetch({
          url: `${registry.url}${requested.pathname}${requested.search}`,
        })
        await route.fulfill({ response })
      })
      contexts.push(context)
      return context.newPage()
    },
    close: async () => {
      for (const context of contexts) {
        await context.unrouteAll({ behavior: "wait" })
        await context.close()
      }
      web.kill()
      await web.exited
      registry.server.stop(true)
    },
  }
}

export const closeSessionUiBrowser = async (): Promise<void> => {
  if (sharedBrowser === undefined) return
  const browser = sharedBrowser
  sharedBrowser = undefined
  await browser.close()
}
