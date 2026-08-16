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
let sharedBrowser: Browser | undefined

export interface SessionUiHarness {
  readonly appUrl: string
  readonly registryRequests: string[]
  readonly newPage: (
    viewport: ViewportSize,
    options?: Pick<BrowserContextOptions, "javaScriptEnabled">,
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

const publicJson = (body: unknown, status = 200): Response => Response.json(body, {
  headers: {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  },
  status,
})

const startRegistry = () => {
  const requests: string[] = []
  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url)
      requests.push(`${url.pathname}${url.search}`)
      if (url.pathname === "/v1/marketplace/stats") {
        return publicJson({
          activeRuntimes: 1,
          paidOutCredits: null,
          totalSessions: 2,
          tradeableTokens: 940_635,
        })
      }
      return publicJson({ error: "not_found" }, 404)
    },
    hostname: "127.0.0.1",
    port: 0,
  })
  return { requests, server, url: `http://127.0.0.1:${server.port}` }
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
    registryRequests: registry.requests,
    newPage: async (viewport, options = {}) => {
      const context = await browser.newContext({ ...options, viewport })
      await context.route("https://gateway.getatm.io/v1/marketplace/**", async (route) => {
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
      for (const context of contexts) await context.close()
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
