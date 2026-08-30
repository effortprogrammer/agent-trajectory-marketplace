import { resolve } from "node:path"

import {
  createMarketplaceHandler,
  marketplaceSecurityHeaders,
} from "../../../web/marketplace-handler"
import { createLocalRegistryProxy } from "../../../web/local-registry-proxy"

const send = (message: Readonly<Record<string, unknown>>): void => {
  if (process.send === undefined) throw new Error("IPC channel is unavailable")
  process.send(message)
}

const registry = Bun.serve({
  async fetch(request) {
    send({
      method: request.method,
      path: new URL(request.url).pathname,
      type: "upstream-request",
    })
    return Response.json({
      challengeId: "chal-0123456789abcdef",
      expiresAt: "2030-01-01T00:00:00.000Z",
      ok: true,
    })
  },
  hostname: "127.0.0.1",
  port: 0,
})
if (registry.port === undefined) throw new Error("Registry fixture omitted its port")
const registryUrl = `http://127.0.0.1:${registry.port}`
const localRegistryProxy = createLocalRegistryProxy({
  configuredUrl: registryUrl,
  responseHeaders: marketplaceSecurityHeaders,
  upstreamFetch: fetch,
})
const handler = await createMarketplaceHandler({
  localPublicStatsUpstream: undefined,
  localRegistryProxy,
  originRevision: "0123456789abcdef0123456789abcdef01234567",
  publicStatsFetch: fetch,
  root: `${resolve(import.meta.dir, "../../../web")}/`,
})
const marketplace = Bun.serve({
  fetch: handler,
  hostname: "127.0.0.1",
  port: 0,
})
if (marketplace.port === undefined) {
  await registry.stop(true)
  throw new Error("Marketplace fixture omitted its port")
}

send({
  marketplacePort: marketplace.port,
  registryConfigured: localRegistryProxy !== undefined,
  type: "ready",
})

let shuttingDown = false
process.on("message", (message) => {
  if (
    shuttingDown
    || typeof message !== "object"
    || message === null
    || !("type" in message)
    || message.type !== "shutdown"
  ) {
    return
  }
  shuttingDown = true
  void (async () => {
    await marketplace.stop(true)
    await registry.stop(true)
    send({ type: "teardown-complete" })
    process.exit(0)
  })()
})
