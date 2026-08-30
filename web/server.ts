import {
  createMarketplaceHandler,
  marketplaceSecurityHeaders,
} from "./marketplace-handler"
import { createLocalRegistryProxy } from "./local-registry-proxy"

const parsePublicStatsUpstream = (configured: string | undefined): URL | undefined => {
  if (configured === undefined || configured === "") return undefined
  const url = new URL(configured)
  const isLoopback = url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]"
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("ATM_LOCAL_PUBLIC_STATS_URL must use HTTPS or a loopback host")
  }
  return url
}

const root = new URL(".", import.meta.url).pathname
const localRegistryProxy = createLocalRegistryProxy({
  configuredUrl: Bun.env.ATM_LOCAL_REGISTRY_URL,
  responseHeaders: marketplaceSecurityHeaders,
  upstreamFetch: fetch,
})
const handler = await createMarketplaceHandler({
  localPublicStatsUpstream: parsePublicStatsUpstream(
    Bun.env.ATM_LOCAL_PUBLIC_STATS_URL,
  ),
  localRegistryProxy,
  originRevision: Bun.env.ATM_ORIGIN_REVISION,
  publicStatsFetch: fetch,
  root,
})
const server = Bun.serve({
  fetch: handler,
  port: Number(Bun.env.PORT ?? 4173),
})

if (process.send !== undefined) {
  let shuttingDown = false
  process.on("message", (message) => {
    if (
      shuttingDown
      || typeof message !== "object"
      || message === null
      || !("type" in message)
      || message.type !== "marketplace-shutdown"
    ) {
      return
    }
    shuttingDown = true
    void (async () => {
      await server.stop(true)
      process.send?.({ type: "marketplace-teardown-complete" })
      process.exit(0)
    })()
  })
  process.send({
    marketplacePort: server.port,
    publicStatsConfigured:
      Bun.env.ATM_LOCAL_PUBLIC_STATS_URL !== undefined
      && Bun.env.ATM_LOCAL_PUBLIC_STATS_URL !== "",
    registryConfigured: localRegistryProxy !== undefined,
    type: "marketplace-ready",
  })
}
console.log(`marketplace ui: http://localhost:${server.port}/`)
