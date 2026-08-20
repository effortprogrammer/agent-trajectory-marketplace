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
      if (url.pathname === "/v1/auth/logout") {
        return logoutStatus === 200
          ? json({ ok: true, revoked: true })
          : json({ error: { code: "unavailable" }, ok: false }, logoutStatus)
      }
      if (url.pathname === "/v1/marketplace/public-stats") {
        return json({ tradeableTokens: 39_048_328 })
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
    url: `http://127.0.0.1:${server.port}`,
  }
}

export const startSessionUiHarness = async (): Promise<SessionUiHarness> => {
  const registry = startRegistry()
  const port = reservePort()
  const web = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: { ...Bun.env, PORT: String(port) },
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
    newPage: async (viewport, options = {}) => {
      const context = await browser.newContext({ ...options, viewport })
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
