import { resolve } from "node:path"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type ViewportSize,
} from "playwright"

import {
  startSessionRegistry,
  type PayoutFixture,
  type RegistryRequest,
} from "./session-marketplace-registry.fixture"

export type { PayoutFixture, RegistryRequest }

const publicRoot = resolve(import.meta.dir, "../../..")
const serverReadyTimeoutMs = 20_000
const resourceTimeoutMs = 10_000
const nativeFetch = globalThis.fetch.bind(globalThis)
let sharedBrowser: Browser | undefined

export interface SessionUiHarness {
  readonly appUrl: string
  readonly holdChallenge: () => () => void
  readonly holdPayout: () => () => void
  readonly holdVerify: () => () => void
  readonly registryRequests: RegistryRequest[]
  readonly setLogoutStatus: (status: number) => void
  readonly setPayoutResponses: (...responses: PayoutFixture[]) => void
  readonly setPublicTokenTotal: (value: number | string) => void
  readonly setVerifyAccountRequired: () => void
  readonly newPage: (
    viewport: ViewportSize,
    options?: Pick<
      BrowserContextOptions,
      "hasTouch" | "isMobile" | "javaScriptEnabled" | "permissions"
    >,
  ) => Promise<Page>
  readonly close: () => Promise<void>
}

type ReadyMessage = Readonly<{
  marketplacePort: number
  publicStatsConfigured: boolean
  registryConfigured: boolean
}>

const waitForReady = async (
  ready: Promise<ReadyMessage>,
  exited: Promise<number>,
): Promise<ReadyMessage> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Marketplace ready IPC event did not arrive")),
      serverReadyTimeoutMs,
    )
  })
  const earlyExit = exited.then((code) => {
    throw new Error(`Marketplace exited before ready IPC with code ${code}`)
  })
  try {
    return await Promise.race([ready, earlyExit, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

const awaitResource = async <Value>(
  label: string,
  resource: Promise<Value>,
): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} did not complete`)),
      resourceTimeoutMs,
    )
  })
  try {
    return await Promise.race([resource, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

type ReadinessFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export const waitForMarketplaceHttpReady = async (
  appUrl: string,
  fetch_: ReadinessFetch = fetch,
): Promise<void> => {
  const response = await awaitResource(
    "Marketplace HTTP readiness",
    fetch_(appUrl),
  )
  if (!response.ok) {
    throw new Error(`Marketplace readiness returned HTTP ${response.status}`)
  }
  await response.body?.cancel()
}

export const startSessionUiHarness = async (): Promise<SessionUiHarness> => {
  const registry = startSessionRegistry()
  const ready = Promise.withResolvers<ReadyMessage>()
  const teardown = Promise.withResolvers<void>()
  const web = Bun.spawn(["bun", "web/server.ts"], {
    cwd: publicRoot,
    env: {
      ...Bun.env,
      ATM_LOCAL_PUBLIC_STATS_URL: `${registry.url}/v1/marketplace/public-stats`,
      ATM_LOCAL_REGISTRY_URL: registry.url,
      PORT: "0",
    },
    ipc(message) {
      if (
        typeof message !== "object"
        || message === null
        || !("type" in message)
      ) {
        return
      }
      if (message.type === "marketplace-teardown-complete") {
        teardown.resolve()
        return
      }
      if (
        message.type !== "marketplace-ready"
        || !("marketplacePort" in message)
        || typeof message.marketplacePort !== "number"
        || !("publicStatsConfigured" in message)
        || typeof message.publicStatsConfigured !== "boolean"
        || !("registryConfigured" in message)
        || typeof message.registryConfigured !== "boolean"
      ) {
        return
      }
      ready.resolve({
        marketplacePort: message.marketplacePort,
        publicStatsConfigured: message.publicStatsConfigured,
        registryConfigured: message.registryConfigured,
      })
    },
    stderr: "pipe",
    stdout: "ignore",
  })
  const shutdownWeb = async (): Promise<void> => {
    web.send({ type: "marketplace-shutdown" })
    await awaitResource("Marketplace teardown IPC", teardown.promise)
    const exitCode = await awaitResource("Marketplace process exit", web.exited)
    if (exitCode !== 0) {
      throw new Error(`Marketplace exited with code ${exitCode}`)
    }
  }
  const contexts: BrowserContext[] = []
  try {
    const readiness = await waitForReady(ready.promise, web.exited)
    if (!readiness.publicStatsConfigured || !readiness.registryConfigured) {
      throw new Error("Marketplace ready IPC reported missing local configuration")
    }
    const appUrl = `http://127.0.0.1:${readiness.marketplacePort}`
    await waitForMarketplaceHttpReady(appUrl, nativeFetch)
    sharedBrowser ??= await awaitResource(
      "Playwright Chromium launch",
      chromium.launch({
        args: ["--disable-background-networking"],
        headless: true,
      }),
    )
    const browser = sharedBrowser
    if (browser === undefined) throw new Error("Playwright Chromium did not launch")
    return {
      appUrl,
      holdChallenge: registry.holdChallenge,
      holdPayout: registry.holdPayout,
      holdVerify: registry.holdVerify,
      registryRequests: registry.requests,
      setLogoutStatus: registry.setLogoutStatus,
      setPayoutResponses: registry.setPayoutResponses,
      setPublicTokenTotal: registry.setPublicTokenTotal,
      setVerifyAccountRequired: registry.setVerifyAccountRequired,
      newPage: async (viewport, options = {}) => {
        const context = await browser.newContext({
          ...options,
          reducedMotion: "reduce",
          viewport,
        })
        contexts.push(context)
        return context.newPage()
      },
      close: async () => {
        try {
          for (const context of contexts) {
            await context.unrouteAll({ behavior: "wait" })
            await awaitResource("browser context close", context.close())
          }
        } finally {
          try {
            await shutdownWeb()
          } finally {
            await awaitResource(
              "Registry fixture stop",
              registry.server.stop(true),
            )
          }
        }
      },
    }
  } catch (error) {
    if (web.exitCode === null) web.kill()
    await awaitResource("Marketplace startup cleanup", web.exited)
    await awaitResource("Registry startup cleanup", registry.server.stop(true))
    throw error
  }
}

export const closeSessionUiBrowser = async (): Promise<void> => {
  if (sharedBrowser === undefined) return
  const browser = sharedBrowser
  sharedBrowser = undefined
  await awaitResource("shared Chromium close", browser.close())
}
